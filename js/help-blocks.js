/**
 * ===============================================================
 * 解説ポップアップ用 ブロック部品
 * ===============================================================
 * 「誰向けの設定？」「？」ポップアップの中身（段落・箇条書き・例・
 * プロンプト例など）を、読みやすく書くための小さな部品関数群。
 * 解説文データ（help-guides.js / help-fields.js）から使う。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /** 見出し（小見出し） */
  function heading(text) { return { type: 'heading', text: text }; }

  /** 通常の段落 */
  function paragraph(text) { return { type: 'paragraph', text: text }; }

  /** 箇条書き（items は文字列の配列） */
  function bullets(items) { return { type: 'bullets', items: items }; }

  /** 「こんな人向け！」など、具体例を目立たせる囲み */
  function example(title, text) { return { type: 'example', title: title, text: text }; }

  /** 注意・補足の囲み */
  function note(text) { return { type: 'note', text: text }; }

  /** AIにそのまま貼り付けられるプロンプト例（コピーボタン付き） */
  function prompt(title, text) { return { type: 'prompt', title: title, text: text }; }

  global.FireHelpBlocks = { heading, paragraph, bullets, example, note, prompt };
})(typeof window !== 'undefined' ? window : globalThis);
