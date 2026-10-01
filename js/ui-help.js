/**
 * ===============================================================
 * 解説ポップアップ（「誰向けの設定？」「？」アイコン）
 * ===============================================================
 * ・各タブの先頭に「💡 誰向けの設定？」ボタンを表示する（help-guides.js の内容）。
 * ・各入力項目の名前の横に「？」ボタンを表示する（help-fields.js の内容）。
 * ・クリックするとポップアップで解説を表示する。
 *
 * 【仕組み】
 * 既存の各タブ描画関数には手を加えず、タブの描画が終わるたびに
 * MutationObserver で検知して、画面上の項目名（ラベル／表の見出し）と
 * 解説データを照合し、アイコンを後付けする（decorateTab）。
 * アイコンの付与は何度実行しても二重にならない（冪等）。
 *
 * 【デバッグ】
 * DEBUG_HELP が true の間は、解説データが見つからなかった項目名を
 * コンソールに出力する（解説の付け忘れ・項目名変更の検知用）。
 * ===============================================================
 */
(function (global) {
  'use strict';
  const { createElement } = global.FireUiHelpers;

  // デバッグ出力の有効/無効（開発完了時にユーザー確認のうえ false にする）
  const DEBUG_HELP = true;

  // 解説データが見つからなかった項目の重複ログ出力を防ぐための記録
  const reportedMissingKeys = {};

  // 「？」アイコンを付ける対象（入力欄の見出し・表の列見出し）
  const FIELD_LABEL_SELECTOR = '.field > label, .data-table th';

  // ポップアップ表示前にフォーカスしていた要素（閉じたときにフォーカスを戻す）
  let elementFocusedBeforeOpen = null;

  // ---------------------------------------------------
  // デバッグ出力
  // ---------------------------------------------------

  /** デバッグ用のログを出力する */
  function debugLog(message) {
    if (!DEBUG_HELP) return;
    console.log('[解説ポップアップ] ' + message);
  }

  /** 解説データが見つからない項目を（1回だけ）ログに出す */
  function reportMissingHelp(tabId, labelText) {
    const key = tabId + '::' + labelText;
    if (reportedMissingKeys[key]) return;
    reportedMissingKeys[key] = true;
    debugLog('解説データなし: タブ=' + tabId + ' 項目名=「' + labelText + '」');
  }

  // ---------------------------------------------------
  // 解説ブロック（段落・箇条書き等）のDOM生成
  // ---------------------------------------------------

  /** 段落ブロックをDOMにする */
  function buildParagraphBlock(block) {
    return createElement('p', { class: 'help-block-p', text: block.text });
  }

  /** 小見出しブロックをDOMにする */
  function buildHeadingBlock(block) {
    return createElement('h4', { class: 'help-block-heading', text: block.text });
  }

  /** 箇条書きブロックをDOMにする */
  function buildBulletsBlock(block) {
    const items = block.items.map(function (text) { return createElement('li', { text: text }); });
    return createElement('ul', { class: 'help-block-bullets' }, items);
  }

  /** 例ブロック（目立たせる囲み）をDOMにする */
  function buildExampleBlock(block) {
    return createElement('div', { class: 'help-block-example' }, [
      createElement('div', { class: 'help-block-example-title', text: '💡 ' + block.title }),
      createElement('div', { text: block.text })
    ]);
  }

  /** 注意・補足ブロックをDOMにする */
  function buildNoteBlock(block) {
    return createElement('div', { class: 'help-block-note', text: '※ ' + block.text });
  }

  /**
   * クリップボードへテキストをコピーする。
   * 通常は navigator.clipboard を使い、使えない環境（http接続など）では
   * 一時的なテキストエリアを使う従来方式にフォールバックする。
   * @returns {Promise<boolean>} コピーに成功したか
   */
  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return copyTextByTemporaryTextarea(text); }
      );
    }
    return Promise.resolve(copyTextByTemporaryTextarea(text));
  }

  /** 一時的なテキストエリアを使ったコピー（フォールバック用） */
  function copyTextByTemporaryTextarea(text) {
    const textarea = createElement('textarea', { class: 'help-copy-temp' });
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch (error) {
      debugLog('コピー失敗: ' + error);
    }
    document.body.removeChild(textarea);
    return succeeded;
  }

  /** コピーボタンを押したときの処理（結果をボタン表示に反映する） */
  function handlePromptCopyClick(button, promptText) {
    copyTextToClipboard(promptText).then(function (succeeded) {
      button.textContent = succeeded ? '✅ コピーしました' : '⚠ コピーできませんでした（手動で選択してください）';
      debugLog('プロンプトのコピー: ' + (succeeded ? '成功' : '失敗'));
      setTimeout(function () { button.textContent = '📋 コピー'; }, 2500);
    });
  }

  /** AIへのプロンプト例ブロック（コピーボタン付き）をDOMにする */
  function buildPromptBlock(block) {
    const copyButton = createElement('button', { type: 'button', class: 'btn btn-sm', text: '📋 コピー' });
    copyButton.addEventListener('click', function () { handlePromptCopyClick(copyButton, block.text); });
    return createElement('div', { class: 'help-block-prompt' }, [
      createElement('div', { class: 'help-block-prompt-head' }, [
        createElement('span', { text: '🤖 ' + block.title }),
        copyButton
      ]),
      createElement('pre', { class: 'help-block-prompt-text', text: block.text })
    ]);
  }

  // ブロック種別 → DOM生成関数 の対応表
  const BLOCK_BUILDERS = {
    paragraph: buildParagraphBlock,
    heading: buildHeadingBlock,
    bullets: buildBulletsBlock,
    example: buildExampleBlock,
    note: buildNoteBlock,
    prompt: buildPromptBlock
  };

  /** ブロック1件を、種別に応じたDOMにする（未知の種別は無視する） */
  function buildBlockElement(block) {
    const builder = BLOCK_BUILDERS[block.type];
    if (!builder) {
      debugLog('未知のブロック種別: ' + block.type);
      return null;
    }
    return builder(block);
  }

  // ---------------------------------------------------
  // ポップアップ（モーダル）の開閉
  // ---------------------------------------------------

  /** 表示中のポップアップを閉じる */
  function closeHelpModal() {
    const overlay = document.getElementById('help-overlay');
    if (!overlay) return;
    overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', handleEscapeKey);
    document.body.classList.remove('help-modal-open');
    if (elementFocusedBeforeOpen && elementFocusedBeforeOpen.focus) {
      elementFocusedBeforeOpen.focus();
    }
    elementFocusedBeforeOpen = null;
    debugLog('ポップアップを閉じました');
  }

  /** Escキーでポップアップを閉じる */
  function handleEscapeKey(event) {
    if (event.key === 'Escape') closeHelpModal();
  }

  /** 暗い背景（オーバーレイ）自体をクリックしたときだけ閉じる */
  function handleOverlayClick(event) {
    if (event.target.id === 'help-overlay') closeHelpModal();
  }

  /** ポップアップのDOM全体（背景＋ダイアログ）を組み立てる */
  function buildHelpModalElement(title, blocks) {
    const closeButton = createElement('button', {
      type: 'button', class: 'help-modal-close', title: '閉じる', 'aria-label': '閉じる', text: '×'
    });
    closeButton.addEventListener('click', closeHelpModal);

    const bodyChildren = blocks.map(buildBlockElement);
    const footerCloseButton = createElement('button', { type: 'button', class: 'btn', text: '閉じる' });
    footerCloseButton.addEventListener('click', closeHelpModal);

    const dialog = createElement('div', {
      class: 'help-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title
    }, [
      createElement('div', { class: 'help-modal-header' }, [
        createElement('h3', { class: 'help-modal-title', text: title }),
        closeButton
      ]),
      createElement('div', { class: 'help-modal-body' }, bodyChildren),
      createElement('div', { class: 'help-modal-footer' }, [footerCloseButton])
    ]);

    const overlay = createElement('div', { id: 'help-overlay', class: 'help-overlay' }, [dialog]);
    overlay.addEventListener('click', handleOverlayClick);
    return overlay;
  }

  /** 解説ポップアップを開く（すでに開いていれば閉じてから開き直す） */
  function openHelpModal(title, blocks) {
    closeHelpModal();
    elementFocusedBeforeOpen = document.activeElement;
    const overlay = buildHelpModalElement(title, blocks);
    document.body.appendChild(overlay);
    document.body.classList.add('help-modal-open');
    document.addEventListener('keydown', handleEscapeKey);
    overlay.querySelector('.help-modal-close').focus();
    debugLog('ポップアップを開きました: ' + title);
  }

  // ---------------------------------------------------
  // 解説データの検索
  // ---------------------------------------------------

  /** 解説エントリの match 指定（文字列＝前方一致／正規表現）が項目名に合致するか */
  function isEntryMatched(entry, labelText) {
    if (entry.match instanceof RegExp) return entry.match.test(labelText);
    return labelText.indexOf(entry.match) === 0;
  }

  /** タブIDと項目名から、該当する解説エントリを探す（無ければ null） */
  function findFieldHelp(tabId, labelText) {
    const entries = (global.FireHelpFields && global.FireHelpFields[tabId]) || [];
    for (let i = 0; i < entries.length; i++) {
      if (isEntryMatched(entries[i], labelText)) return entries[i];
    }
    return null;
  }

  // ---------------------------------------------------
  // アイコンの後付け
  // ---------------------------------------------------

  /** 「？」ボタンを1つ作る（クリックで項目解説を開く） */
  function createFieldHelpButton(entry) {
    const button = createElement('button', {
      type: 'button', class: 'help-icon', title: 'この項目の説明を見る', 'aria-label': entry.title + 'の説明', text: '?'
    });
    button.addEventListener('click', function (event) {
      // ラベル内に置くため、ラベルのクリック動作（チェックボックスの切替・入力欄へのフォーカス）を止める
      event.preventDefault();
      event.stopPropagation();
      openHelpModal(entry.title, entry.blocks);
    });
    return button;
  }

  /** 項目名の要素（ラベル／表見出し）1つに「？」を付ける（付与済みなら何もしない） */
  function decorateOneLabel(labelElement, tabId) {
    if (labelElement.getAttribute('data-help-decorated') === '1') return;
    const labelText = labelElement.textContent.trim();
    if (labelText === '') return;

    labelElement.setAttribute('data-help-decorated', '1');
    const entry = findFieldHelp(tabId, labelText);
    if (!entry) {
      reportMissingHelp(tabId, labelText);
      return;
    }
    labelElement.appendChild(createFieldHelpButton(entry));
  }

  /** タブ内の全ての項目名に「？」を付ける */
  function decorateFieldLabels(container, tabId) {
    // 項目解説データのないタブ（実行・結果画面の結果表など）には「？」を付けない
    if (!global.FireHelpFields || !global.FireHelpFields[tabId]) return;
    const labels = container.querySelectorAll(FIELD_LABEL_SELECTOR);
    for (let i = 0; i < labels.length; i++) {
      decorateOneLabel(labels[i], tabId);
    }
  }

  /** 「誰向けの設定？」ボタンを含む案内バーを作る */
  function createGuideBar(guide) {
    const button = createElement('button', {
      type: 'button', class: 'help-guide-btn', title: 'この設定が自分に必要か、例を見て判断できます'
    }, [
      createElement('span', { class: 'help-guide-btn-icon', text: '💡' }),
      createElement('span', { text: guide.title.indexOf('見方') !== -1 ? ' 見方の案内' : ' 誰向けの設定？' })
    ]);
    button.addEventListener('click', function () { openHelpModal(guide.title, guide.blocks); });

    return createElement('div', { class: 'help-guide-bar' }, [
      button,
      createElement('span', {
        class: 'help-guide-hint',
        text: '項目名の横の「?」を押すと、その項目の説明が出ます'
      })
    ]);
  }

  /** タブの先頭に「誰向けの設定？」バーを付ける（付与済みなら何もしない） */
  function decorateGuideBar(container, tabId) {
    const guide = global.FireHelpGuides && global.FireHelpGuides[tabId];
    if (!guide) {
      debugLog('タブの解説データなし: タブ=' + tabId);
      return;
    }
    if (container.querySelector(':scope > .help-guide-bar')) return;
    container.insertBefore(createGuideBar(guide), container.firstChild);
  }

  /** 表示中のタブに、案内バーと「？」アイコンをまとめて付ける */
  function decorateTab(container, tabId) {
    decorateGuideBar(container, tabId);
    decorateFieldLabels(container, tabId);
  }

  // ---------------------------------------------------
  // 画面更新の監視
  // ---------------------------------------------------

  /**
   * タブ表示領域を監視し、中身が描き替えられるたびに decorateTab を実行する。
   * decorate 自身のDOM変更で再度反応しないよう、実行中は監視を一時停止する。
   * @param {HTMLElement} contentElement タブ内容の表示領域
   * @param {Function} getCurrentTabId 現在のタブIDを返す関数
   */
  function attachHelpDecorator(contentElement, getCurrentTabId) {
    const observerOptions = { childList: true, subtree: true };

    const observer = new MutationObserver(function () {
      observer.disconnect();
      decorateTab(contentElement, getCurrentTabId());
      observer.observe(contentElement, observerOptions);
    });

    decorateTab(contentElement, getCurrentTabId());
    observer.observe(contentElement, observerOptions);
    debugLog('解説アイコンの自動付与を開始しました');
  }

  global.FireUiHelp = { attachHelpDecorator, decorateTab, openHelpModal, closeHelpModal, findFieldHelp };
})(typeof window !== 'undefined' ? window : globalThis);
