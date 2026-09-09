/**
 * ===============================================================
 * 汎用編集可能テーブル
 * ===============================================================
 * 銘柄一覧・収入イベント一覧など「行の追加・編集・削除」を行う
 * 画面はすべて同じ構造（テーブル＋行追加ボタン）になるため、
 * カラム定義（column definitions）を渡すだけで動く共通部品にする。
 *
 * 【使い方】
 *   renderEditableTable(container, {
 *     columns: [ { key:'name', label:'名前', type:'text' }, ... ],
 *     rows: appData.income,
 *     createEmptyRow: () => ({ name: '', ... }),
 *     onChange: (newRows) => { appData.income = newRows; saveAndRerender(); }
 *   });
 * ===============================================================
 */
(function (global) {
  'use strict';
  const { createElement } = global.FireUiHelpers;

  /** 1つのセル（入力欄）を、カラム定義とその行の値から生成する */
  function createCellInput(column, row, onCellChange) {
    if (column.type === 'select') {
      const select = createElement('select', {
        onchange: (e) => onCellChange(column.key, e.target.value)
      }, (column.options || []).map((opt) => {
        const optionEl = createElement('option', { value: opt.value, text: opt.label });
        if (row[column.key] === opt.value) optionEl.selected = true;
        return optionEl;
      }));
      return select;
    }
    if (column.type === 'checkbox') {
      const input = createElement('input', { type: 'checkbox' });
      input.checked = !!row[column.key];
      input.addEventListener('change', (e) => onCellChange(column.key, e.target.checked));
      return input;
    }
    const inputType = column.type === 'month' ? 'month' : (column.type === 'number' ? 'number' : 'text');
    const input = createElement('input', { type: inputType });
    if (column.type === 'number' && column.step !== undefined) input.step = column.step;
    if (column.type === 'number') {
      // 数値専用キーボード（スマホでの入力ミス防止）。ステップに小数が含まれる場合は
      // 小数入力用のキーボードにする（全角文字はtype=numberの仕様上そもそも入力できない）
      input.inputMode = (column.step !== undefined && String(column.step).indexOf('.') !== -1) ? 'decimal' : 'numeric';
    }
    if (column.type === 'month') {
      // 西暦は4桁の範囲に限定する（それ以上先・過去の年は現実的に使わないため）
      input.min = '1900-01';
      input.max = '2199-12';
    }
    // 列ごとに最小幅を指定できるようにする（銘柄名など長いテキストを入力する列向け）
    if (column.width) input.style.minWidth = column.width;
    input.value = row[column.key] === undefined || row[column.key] === null ? '' : row[column.key];
    input.addEventListener('change', (e) => {
      let value = e.target.value;
      if (column.type === 'number') value = value === '' ? 0 : parseFloat(value);
      onCellChange(column.key, value);
    });
    return input;
  }

  /**
   * 編集可能テーブルを container 内に描画する。
   * @param {HTMLElement} container 描画先の要素（内容はクリアされる）
   * @param {Object} config
   *   columns        : [{ key, label, type: 'text'|'number'|'month'|'select'|'checkbox', options?, step?, width? }]
   *   rows           : 現在の行データの配列
   *   createEmptyRow : 新規行を生成する関数（() => object）
   *   onChange       : 行データが変化したときに呼ばれる関数（rows => void）
   *   addButtonLabel : 追加ボタンのラベル（省略時「＋行を追加」）
   */
  function renderEditableTable(container, config) {
    container.innerHTML = '';
    const rows = config.rows;

    const table = createElement('table', { class: 'data-table' });
    const thead = createElement('thead', {}, [
      createElement('tr', {}, config.columns.map((c) => createElement('th', { text: c.label }))
        .concat([createElement('th', { class: 'col-action', text: '' })]))
    ]);
    table.appendChild(thead);

    const tbody = createElement('tbody');
    rows.forEach((row, rowIndex) => {
      const onCellChange = (key, value) => {
        row[key] = value;
        config.onChange(rows);
      };
      const cells = config.columns.map((column) =>
        createElement('td', {}, [createCellInput(column, row, onCellChange)]));

      const deleteBtn = createElement('button', {
        class: 'btn btn-sm btn-danger', text: '×', title: 'この行を削除',
        onclick: () => {
          rows.splice(rowIndex, 1);
          config.onChange(rows);
          renderEditableTable(container, config);
        }
      });
      cells.push(createElement('td', { class: 'col-action' }, [deleteBtn]));
      tbody.appendChild(createElement('tr', {}, cells));
    });
    table.appendChild(tbody);
    // 列数・列幅指定によりテーブルが横に広くなる場合があるため、横スクロール可能な枠で囲む
    container.appendChild(createElement('div', { class: 'table-scroll' }, [table]));

    if (rows.length === 0) {
      container.appendChild(createElement('p', { class: 'help-text', text: '（まだ登録がありません）' }));
    }

    const addBtn = createElement('button', {
      class: 'btn btn-sm',
      text: config.addButtonLabel || '＋ 行を追加',
      onclick: () => {
        rows.push(config.createEmptyRow());
        config.onChange(rows);
        renderEditableTable(container, config);
      }
    });
    if (config.disableAddReason) {
      // 追加先となる対象（銘柄など）が無い場合は、追加ボタンを無効化し理由を案内する
      addBtn.disabled = true;
      container.appendChild(createElement('div', { class: 'row-actions' }, [addBtn]));
      container.appendChild(createElement('p', { class: 'help-text', text: config.disableAddReason }));
    } else {
      container.appendChild(createElement('div', { class: 'row-actions' }, [addBtn]));
    }
  }

  global.FireUiTables = { renderEditableTable };
})(typeof window !== 'undefined' ? window : globalThis);
