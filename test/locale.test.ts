import assert from "node:assert/strict";
import test from "node:test";
import { preferredLocale } from "../lib/locale.ts";
import { localizedError } from "../lib/locale-errors.ts";

test("the highest-priority supported browser language determines the interface", () => {
  assert.equal(preferredLocale("zh-Hans-CN,zh;q=0.9,en;q=0.8"), "zh-CN");
  assert.equal(preferredLocale("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
  assert.equal(preferredLocale("en;q=0.3, zh-TW;q=0.8"), "zh-CN");
  assert.equal(preferredLocale("fr-CA, zh-HK;q=0.7, en;q=0.5"), "zh-CN");
  assert.equal(preferredLocale("zh;q=0.8,en;q=0.8"), "zh-CN");
});

test("missing, excluded or unsupported languages fall back to English", () => {
  for (const header of [null, "", "*", "ja-JP,es;q=0.9", "zh;q=0", "zh;q=no,zh;q=2"]) {
    assert.equal(preferredLocale(header), "en");
  }
});

test("Chinese errors keep their dynamic details and English errors pass through", () => {
  assert.equal(localizedError("Uploads must total no more than 512 MB.", "zh-CN"), "上传文件总大小不能超过 512 MB。");
  assert.equal(localizedError("Prompt outputs failed validation", "zh-CN"), "工作流未通过校验。");
  assert.equal(localizedError("Pivot must be 0.01 to 1.", "zh-CN"), "对比度中点须在 0.01 至 1 之间。");
  assert.equal(localizedError("Unexpected ComfyUI error", "zh-CN"), "错误详情：Unexpected ComfyUI error");
  assert.equal(localizedError("Prompt outputs failed validation", "en"), "Prompt outputs failed validation");
  assert.equal(localizedError("", "zh-CN"), "");
});
