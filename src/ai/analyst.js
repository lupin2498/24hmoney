import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ArticleAnalysisSchema, DigestSchema } from "./schemas.js";
import { ARTICLE_SYSTEM, DIGEST_SYSTEM, articlePrompt, digestPrompt } from "./prompts.js";

export class AiError extends Error {
  /**
   * code: auth | billing | config | bad_request | refusal | rate_limit | unavailable | bad_output | max_tokens
   * fatal: lỗi cấu hình/tài khoản – tạm dừng gọi AI cho tới khi cấu hình lại.
   */
  constructor(message, { code, retryable = false, fatal = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.fatal = fatal;
  }
}

function toOutputFormat(schema) {
  // Chuyển zod → JSON Schema (giữ enum, required, additionalProperties: false) cho structured outputs.
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema);
  return { type: "json_schema", schema: jsonSchema };
}

// Các model cũ không nhận tham số effort.
const supportsEffort = (model) => !/claude-(3|haiku-4-5|sonnet-4-5|opus-4-1|opus-4-0|sonnet-4-0)/.test(model);

export function classifyError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || /Could not resolve authentication/i.test(err?.message || "")) {
    return new AiError("Chưa cấu hình hoặc sai ANTHROPIC_API_KEY.", { code: "auth", fatal: true });
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError(`API key không có quyền sử dụng model này (${err.message}).`, { code: "auth", fatal: true });
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError(`Không tìm thấy model hoặc endpoint (${err.message}). Kiểm tra CLAUDE_MODEL.`, { code: "config", fatal: true });
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance|billing/i.test(err.message)) {
      return new AiError("Tài khoản Anthropic hết tín dụng.", { code: "billing", fatal: true });
    }
    return new AiError(`Yêu cầu không hợp lệ: ${err.message}`, { code: "bad_request" });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Vượt giới hạn tốc độ của API, sẽ thử lại sau.", { code: "rate_limit", retryable: true });
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIError) {
    return new AiError(`API tạm thời không khả dụng: ${err.message}`, { code: "unavailable", retryable: true });
  }
  return new AiError(err?.message || String(err), { code: "unknown", retryable: true });
}

const truncate = (text, max) => {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, max)}\n[...nội dung còn lại đã được lược bớt]`;
};

const uniq = (arr) => [...new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))];

export class Analyst {
  constructor(aiConfig, { client } = {}) {
    this.cfg = aiConfig;
    this.client = client || new Anthropic({ maxRetries: 3 });
    this.articleFormat = toOutputFormat(ArticleAnalysisSchema);
    this.digestFormat = toOutputFormat(DigestSchema);
  }

  async analyzeArticle(article, now = new Date()) {
    const content = truncate(article.content, this.cfg.maxArticleChars);
    const { data, meta } = await this.#call({
      system: ARTICLE_SYSTEM,
      user: articlePrompt(article, content, now),
      format: this.articleFormat,
      schema: ArticleAnalysisSchema,
      effort: this.cfg.articleEffort,
      maxTokens: 32000,
    });
    data.tickers = uniq(data.tickers.map((t) => t.toUpperCase())).filter((t) => /^[A-Z0-9]{3,4}$/.test(t));
    data.sectors = uniq(data.sectors);
    return { analysis: data, ...meta };
  }

  async writeDigest(dateKey, articles, now = new Date()) {
    const { data, meta } = await this.#call({
      system: DIGEST_SYSTEM,
      user: digestPrompt(dateKey, articles, now),
      format: this.digestFormat,
      schema: DigestSchema,
      effort: this.cfg.digestEffort,
      maxTokens: 64000,
    });
    const known = new Set(articles.map((a) => a.id));
    for (const theme of data.themes) theme.article_ids = uniq(theme.article_ids).filter((id) => known.has(id));
    return { digest: data, ...meta };
  }

  async #call({ system, user, format, schema, effort, maxTokens }) {
    const { model } = this.cfg;
    const params = {
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format, ...(effort && supportsEffort(model) ? { effort } : {}) },
    };
    if (this.cfg.fallbacks) {
      // Nếu model chính từ chối vì chính sách an toàn, API tự chạy lại trên model dự phòng được khuyến nghị.
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    let message;
    try {
      message = await this.client.beta.messages.stream(params).finalMessage();
    } catch (err) {
      throw classifyError(err);
    }

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category || "không rõ";
      throw new AiError(`Model từ chối xử lý nội dung này (nhóm: ${category}).`, { code: "refusal" });
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiError("Phản hồi bị cắt ngang do vượt giới hạn max_tokens.", { code: "max_tokens", retryable: true });
    }

    // Khi có chuyển sang model dự phòng giữa chừng, chỉ lấy phần trả lời sau lần chuyển cuối cùng.
    const blocks = message.content;
    let start = 0;
    blocks.forEach((b, i) => {
      if (b.type === "fallback") start = i + 1;
    });
    const text = blocks
      .slice(start)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError("Phản hồi của model không phải JSON hợp lệ.", { code: "bad_output", retryable: true });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AiError(`Phản hồi sai cấu trúc: ${parsed.error.message.slice(0, 300)}`, {
        code: "bad_output",
        retryable: true,
      });
    }

    const u = message.usage || {};
    return {
      data: parsed.data,
      meta: {
        model: message.model || model,
        usage: {
          input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
          output: u.output_tokens || 0,
        },
      },
    };
  }
}
