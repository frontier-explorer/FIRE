/**
 * ===============================================================
 * シミュレーション実行タブ
 * ===============================================================
 * 「実行」ボタン押下でモンテカルロシミュレーションを実行し、
 * 進捗表示・サマリー統計・ファンチャート・試行別の月次詳細・
 * CSV出力までを担当する。
 * ===============================================================
 */
(function (global) {
  'use strict';
  const { createElement, formatYen, formatPercent, showToast } = global.FireUiHelpers;

  // 成功率に応じた評価（Kotlin版 AssessmentLevel に対応）
  const ASSESSMENT_LEVELS = [
    { min: 99.0, title: 'FIREしないリスクを検討しましょう😊', comment: '成功率が極めて高く、もはや「仕事を続けること」のリスクを検討する段階です。好きな仕事ならば続けましょう。我慢している仕事ならば、1度しかない人生について深く考えましょう。資産計画は優秀です。' },
    { min: 95.0, title: '極めて高い確実性', comment: 'あなたのFIRE計画は極めて高い確実性を持っています。「パーフェクトストーム」のような複数の危機が重なる事態が連続しない限り、枯渇する可能性は低いです。' },
    { min: 90.0, title: '高い確実性だがリスクあり', comment: '比較的高い確実性です。予期せぬ大きな出費や、市場が長期間停滞する場合に資産は枯渇します。万が一の場合の収入源を確保するなど、より厳しい検討が必要です。' },
    { min: 80.0, title: '危険水域・十分な検討が必要', comment: 'FIREの確実性としては不十分です。資産の増強や生活費の見直しを強く推奨します。' },
    { min: 50.0, title: '極めて危険', comment: '失敗する確率と成功する確率がほとんど変わりません。現状のデータでは正社員を辞めるべきではありません。' },
    { min: 40.0, title: 'ダメ絶対', comment: 'シミュレーションの大半で資産が枯渇するという結果になりました。FIREのFの字すら語る段階ではありません。' },
    { min: 20.0, title: 'え？', comment: '定率で右肩上がりに利益が出る非現実的なシミュレーターで満足しておくべき段階です。' },
    { min: 0.0, title: '…', comment: '成功率が極めて低い状態です。' }
  ];

  function getAssessment(successRate) {
    return ASSESSMENT_LEVELS.find((level) => successRate >= level.min) || ASSESSMENT_LEVELS[ASSESSMENT_LEVELS.length - 1];
  }

  // 実行結果をタブ切り替え後も保持するためのモジュール内状態
  let lastResults = null;
  let lastAppDataForSimulation = null;

  // 試行一覧の絞り込み・並び順・選択中の試行を保持するモジュール内状態
  let trialListFilter = 'all'; // 'all' | 'success' | 'failure'
  let trialListSortDir = 'asc'; // 'asc'（少ない順） | 'desc'（多い順）
  let selectedTrialId = null;

  // 「N年以上運用した場合の平均年率（CAGR）マイナスを異常値として除外」フィルタの
  // 選択中の年数（null＝フィルタなし）。サマリー・試行一覧/詳細の再集計にのみ使う。
  // ファンチャート・生活費テーブル・CSV出力には適用しない。
  let anomalyExcludeYears = null;
  // コンボボックスの選択肢（年数）。15年から5年刻みで100年まで
  const ANOMALY_EXCLUDE_YEAR_OPTIONS = [];
  for (let y = 15; y <= 100; y += 5) ANOMALY_EXCLUDE_YEAR_OPTIONS.push(y);

  // 試行一覧パネル（左：一覧／右：詳細）のDOM参照。生活費テーブルなど、
  // 他パネルから「この試行番号の詳細を見せる」という操作を行うために保持しておく
  let trialListPanelRefs = null;

  /**
   * 試行番号を指定して選択状態にし、試行一覧・詳細エリアを更新する。
   * 試行一覧の左側の行を選択したときと全く同じ描画処理を呼び出す（＝同じ動きにする）。
   * 生活費テーブルの破綻ケース一覧など、試行一覧パネルの外から選択するために使う。
   */
  function selectTrialById(trialId) {
    if (!trialListPanelRefs) return;
    const { results, stocks, controlsContainer, listContainer, detailContainer, rightColumn } = trialListPanelRefs;

    // trialListPanelRefs.results は「長期平均年率マイナスの異常値除外」フィルタ適用後の配列。
    // 生活費テーブル等、フィルタ非適用のパネルから除外済みの試行番号を指定された場合は、
    // 詳細を表示せずに理由を通知する（除外ケースを一覧・詳細のどちらからも見せないため）
    const targetExists = results.some((r) => r.trialId === trialId);
    if (!targetExists) {
      showToast('このケースは現在のフィルタ条件（長期平均年率マイナスの異常値除外）により除外されています');
      return;
    }

    selectedTrialId = trialId;
    // 絞り込み条件によって対象の試行が一覧から消えてしまわないよう、「すべて」に戻す
    trialListFilter = 'all';
    renderTrialListControls(controlsContainer, results, stocks, listContainer, detailContainer, rightColumn);
    renderTrialListTable(listContainer, results, stocks, detailContainer, rightColumn);
    if (typeof detailContainer.scrollIntoView === 'function') {
      detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** 実行タブ全体を描画する */
  function renderTabRun(container, appData, onChange) {
    container.innerHTML = '';

    const runPanel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: 'シミュレーション実行' }),
      createElement('p', { class: 'desc', text: '設定した内容でモンテカルロシミュレーションを実行します。試行回数・シミュレーション期間が大きいほど時間がかかります。' })
    ]);

    const progressWrap = createElement('div', { class: 'progress-wrap' }, [createElement('div', { class: 'progress-bar', id: 'progress-bar' })]);
    const progressLabel = createElement('p', { class: 'help-text', id: 'progress-label', text: '' });

    const runBtn = createElement('button', {
      class: 'btn btn-primary', text: '▶ シミュレーションを実行 (' + appData.config.times + '試行 × ' + appData.config.period + '年)',
      onclick: () => runSimulationAndRender(container, appData, onChange, runBtn, progressWrap, progressLabel)
    });

    runPanel.appendChild(createElement('div', { class: 'row-actions' }, [runBtn]));
    runPanel.appendChild(progressWrap);
    runPanel.appendChild(progressLabel);
    container.appendChild(runPanel);

    const resultsContainer = createElement('div', { id: 'results-container' });
    container.appendChild(resultsContainer);

    // 前回の実行結果があれば再描画する（タブを行き来しても結果が消えないように）
    if (lastResults) {
      renderResults(resultsContainer, lastAppDataForSimulation, lastResults);
    }
  }

  /** 銘柄が0件の場合は実行できない旨を伝える */
  function validateBeforeRun(appData) {
    if (appData.stocks.length === 0) return '保有銘柄が1件も登録されていません。「保有銘柄」タブで銘柄を追加してください。';
    return null;
  }

  /**
   * シミュレーションを実行し、進捗表示を更新しながら結果を描画する。
   * 内部では FireEngine.runSimulationChunked() を使い、一定件数ごとに
   * ブラウザへ制御を戻しながら実行することで、ブラウザのUIスレッドを
   * ブロックせず、進捗バー・件数表示が実際に更新されていくようにしている。
   */
  function runSimulationAndRender(container, appData, onChange, runBtn, progressWrap, progressLabel) {
    const validationError = validateBeforeRun(appData);
    if (validationError) { showToast(validationError, 4000); return; }

    const preparedAppData = FirePrepare.prepareAppDataForSimulation(appData);
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';

    runBtn.disabled = true;
    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';
    progressLabel.textContent = '実行中… (0 / ' + preparedAppData.config.times + ')';

    // シミュレーションは重い処理のため、進捗バーの初期表示（0%）が確実に
    // 画面へ反映されるよう、1フレーム分遅延させてから実行を開始する
    setTimeout(() => {
      const startTime = performance.now();

      FireEngine.runSimulationChunked(
        preparedAppData,
        (t, total) => {
          const pct = Math.round((t / total) * 100);
          progressBar.style.width = pct + '%';
          progressLabel.textContent = '実行中… (' + t + ' / ' + total + ')';
        },
        (results) => {
          const elapsedMs = Math.round(performance.now() - startTime);
          progressBar.style.width = '100%';
          progressLabel.textContent = '完了（' + (elapsedMs / 1000).toFixed(1) + '秒）';
          runBtn.disabled = false;

          lastResults = results;
          lastAppDataForSimulation = preparedAppData;
          trialListFilter = 'all';
          trialListSortDir = 'asc';
          selectedTrialId = null;
          trialListPanelRefs = null;
          anomalyExcludeYears = null;

          renderResults(resultsContainer, preparedAppData, results);
          showToast('シミュレーションが完了しました');
        }
      );
    }, 30);
  }

  /**
   * 実行結果全体（異常値除外フィルタ・サマリー・チャート・試行詳細）を描画する。
   * 「N年以上運用した場合の平均年率マイナスを異常値として除外」フィルタは、
   * サマリーと試行一覧/詳細のみに適用し、ファンチャート・生活費テーブル・
   * CSV出力には全試行（results）をそのまま使う。
   */
  function renderResults(container, appData, results) {
    container.innerHTML = '';
    const filteredResults = FireEngine.filterOutLongTermNegativeReturnAnomalies(results, anomalyExcludeYears);
    const summary = FireEngine.calculateSummary(filteredResults, appData.config.failureDetailLimit);

    container.appendChild(renderAnomalyExcludeFilterPanel(container, appData, results));
    container.appendChild(renderSummaryCards(summary));
    container.appendChild(renderAssessmentBox(summary));
    container.appendChild(renderLifeCostTablePanel(results));
    container.appendChild(renderFanChartPanel(results));
    container.appendChild(renderCsvExportPanel(results, appData.stocks));
    container.appendChild(renderTrialListPanel(filteredResults, appData.stocks));
  }

  /**
   * 「N年以上運用した場合の平均年率（CAGR）マイナスを異常値として除外」フィルタの
   * コンボボックスを描画する。選択を変更すると、実行結果全体（renderResults）を
   * 選び直した条件で再描画する。
   */
  function renderAnomalyExcludeFilterPanel(container, appData, results) {
    const hasEligibleStock = appData.stocks.some((s) => s.anomalyFilterEligible === true);

    const makeOption = (value, label) => {
      const attrs = { value, text: label };
      const isSelected = (anomalyExcludeYears === null && value === '') ||
        (anomalyExcludeYears !== null && value === String(anomalyExcludeYears));
      if (isSelected) attrs.selected = 'selected';
      return createElement('option', attrs);
    };

    const options = [makeOption('', 'フィルタなし（すべて集計に含める）')]
      .concat(ANOMALY_EXCLUDE_YEAR_OPTIONS.map((y) => makeOption(String(y), y + '年時点の平均年率マイナスを除外')));

    const select = createElement('select', {
      class: 'form-select',
      onchange: (e) => {
        const v = e.target.value;
        anomalyExcludeYears = v === '' ? null : parseInt(v, 10);
        renderResults(container, appData, results);
      }
    }, options);
    // createElement は setAttribute で属性を設定するため、disabled:false を渡すと
    // 属性が存在するだけでdisabled扱いになってしまう（HTML仕様）。ここではプロパティで直接設定する。
    select.disabled = !hasEligibleStock;

    const excludedCount = results.length - FireEngine.filterOutLongTermNegativeReturnAnomalies(results, anomalyExcludeYears).length;

    const descLines = [
      'オルカンやS&P500等のインデックス投資は、実際の歴史上は15年以上運用を続けた場合の' +
        '平均年率（CAGR）がマイナスになった実例がほとんどなく、運用期間が長くなるほどその傾向は' +
        '強まります。モンテカルロシミュレーションでは、こうした歴史的には考えにくい長期平均年率' +
        'マイナス（外れ値）も一定確率で発生します。ここで年数を選ぶと、「保有銘柄」タブで' +
        '「異常値除外の対象」にチェックを入れた銘柄について、開始時点からその年数経過時点までの' +
        '平均年率がマイナスだったケースを母数から除外して、サマリーと試行一覧・詳細に反映します' +
        '（ファンチャート・生活費テーブル・CSV出力には影響しません）。'
    ];
    if (!hasEligibleStock) {
      descLines.push('※「保有銘柄」タブで「異常値除外の対象」にチェックを入れた銘柄が1件もないため、現在は選択できません。');
    }

    return createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '異常値（歴史的に考えにくい長期平均年率マイナス）の除外' }),
      createElement('p', { class: 'desc', text: descLines.join(' ') }),
      createElement('div', { class: 'trial-select' }, [select]),
      createElement('p', {
        class: 'help-text',
        text: anomalyExcludeYears
          ? ('除外件数：' + excludedCount + '件／全' + results.length + '件中')
          : ''
      })
    ]);
  }

  /** サマリー統計カードを描画する */
  function renderSummaryCards(summary) {
    const makeCard = (label, value, cls) => createElement('div', { class: 'stat-card' }, [
      createElement('div', { class: 'label', text: label }),
      createElement('div', { class: 'value' + (cls ? ' ' + cls : ''), text: value })
    ]);

    return createElement('div', { class: 'summary-cards' }, [
      makeCard('成功率', formatPercent(summary.successRate), summary.successRate >= 80 ? 'success' : (summary.successRate < 50 ? 'danger' : '')),
      makeCard('成功試行数', summary.successCount + ' / ' + summary.totalTrials),
      makeCard('成功時 中央値資産', formatYen(summary.medianSuccessAsset)),
      makeCard('成功時 下位10%資産', formatYen(summary.worst10thAsset)),
      makeCard('失敗時 中央値破綻月', summary.failureCount > 0 ? (summary.medianFailureMonth / 12).toFixed(1) + '年目' : '-')
    ]);
  }

  /** 総合評価ボックスを描画する */
  function renderAssessmentBox(summary) {
    const assessment = getAssessment(summary.successRate);
    return createElement('div', { class: 'assessment-box' }, [
      createElement('div', { class: 'title', text: assessment.title }),
      createElement('div', { class: 'comment', text: assessment.comment })
    ]);
  }

  /**
   * 「月の生活費」テーブルを描画する（資産推移グラフより上に表示）。
   * 縦軸＝年（5年ごと）、横軸＝生活費が多い順に並べた層（パーセンタイル）。
   * 各セルには生活費の金額と、その年までに破綻した試行数を表示する。
   */
  function renderLifeCostTablePanel(results) {
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '月の生活費（生活費の分布）' }),
      createElement('p', {
        class: 'desc',
        text: '資産額だけでなく支出側のブレ幅にも注目するための表です。5年ごとに、生活費（インフレ／デフレ適用後・大きな出費を含む）が多い順に生存試行を並べ、上位1％・20％・40％・中央値・70％・90％・下位（最安）の層の金額を表示します。（）は、直近の区間（前の基準年より後、その年まで）に新たに破綻した試行の件数で、破綻した瞬間の生活水準がどの層に相当するかで振り分けています。件数をクリックすると該当する試行番号の一覧が開き、番号を選ぶとその試行の詳細を表示します。生活費が高い層ほど破綻が多いのか、それとも生活費よりも株価等の影響が大きいのかを見るための集計です。'
      })
    ]);

    const rows = FireEngine.calculateLifeCostTable(results, 5);
    if (rows.length === 0) {
      panel.appendChild(createElement('p', { class: 'desc', text: '表示できるデータがありません。' }));
      return panel;
    }

    panel.appendChild(createLifeCostTableElement(rows));
    return panel;
  }

  /** 「月の生活費」テーブルのDOM（table要素）を、集計済みの行データから組み立てる */
  function createLifeCostTableElement(rows) {
    const tierLabels = rows[0].tiers.map((tier) => tier.label);

    const headerRow = createElement('tr', {}, [
      createElement('th', { text: '年' }),
      ...tierLabels.map((label) => createElement('th', { text: label }))
    ]);

    const bodyRows = rows.map((row) => createLifeCostTableRow(row));

    const table = createElement('table', { class: 'data-table life-cost-table' }, [
      createElement('thead', {}, [headerRow]),
      createElement('tbody', {}, bodyRows)
    ]);

    return createElement('div', { class: 'table-scroll' }, [table]);
  }

  /** 「月の生活費」テーブルの1行（1年分）を組み立てる */
  function createLifeCostTableRow(row) {
    const cells = row.tiers.map((tier) => createLifeCostTableCell(tier.value, tier.failedTrialIds, row.totalTrials));
    return createElement('tr', {}, [
      createElement('td', { text: row.year + '年目' }),
      ...cells
    ]);
  }

  /**
   * 「月の生活費」テーブルの1セルを組み立てる。
   * 生活費の金額の下に「（破綻N件）」をヘッダーとしたリストボックス（details/summary）を配置し、
   * 展開すると該当する試行番号の一覧が表示される。番号を選ぶと、試行別結果一覧のリストから
   * 選んだときと同じ動きで、右側の詳細エリアにその試行の内容を表示する。
   */
  function createLifeCostTableCell(value, failedTrialIds, totalTrials) {
    const amountText = value === null ? '－（生存試行なし）' : formatYen(value);
    const cell = createElement('td', {}, [
      createElement('div', { text: amountText }),
      createLifeCostFailureList(failedTrialIds)
    ]);
    if (failedTrialIds.length > 0) {
      // 該当件数の割合が高いほど、濃い赤系の背景で視覚的に警告する
      const ratio = totalTrials > 0 ? Math.min(failedTrialIds.length / totalTrials, 1.0) : 0;
      cell.style.backgroundColor = 'rgba(248, 113, 113, ' + (0.08 + ratio * 0.5).toFixed(2) + ')';
    }
    return cell;
  }

  /** 破綻件数（0件の場合はテキストのみ、1件以上ならリストボックス）のDOMを組み立てる */
  function createLifeCostFailureList(failedTrialIds) {
    const summaryText = '（破綻 ' + failedTrialIds.length + '件）';
    if (failedTrialIds.length === 0) {
      return createElement('div', { class: 'life-cost-failure-note', text: summaryText });
    }

    const listItems = failedTrialIds.slice().sort((a, b) => a - b).map((trialId) => createElement('li', {}, [
      createElement('button', {
        type: 'button',
        class: 'life-cost-failure-item',
        text: '試行 #' + trialId,
        onclick: () => selectTrialById(trialId)
      })
    ]));

    return createElement('details', { class: 'life-cost-failure-list' }, [
      createElement('summary', { text: summaryText }),
      createElement('ul', {}, listItems)
    ]);
  }

  /** パーセンタイル資産推移ファンチャートを描画する */
  function renderFanChartPanel(results) {
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '資産推移（パーセンタイル）' }),
      createElement('p', { class: 'desc', text: '全試行の資産推移を10/25/50/75/90パーセンタイルで表示します。' })
    ]);
    const chartWrap = createElement('div', { class: 'chart-wrap' });
    const canvas = createElement('canvas', { style: 'width:100%; height:280px; display:block;' });
    chartWrap.appendChild(canvas);
    panel.appendChild(chartWrap);

    const timeline = FireEngine.calculatePercentileTimeline(results, 6);
    // canvasはDOMに追加された後でないと正しいサイズが取れないため、描画は次フレームで行う
    requestAnimationFrame(() => FireChart.drawFanChart(canvas, timeline));

    return panel;
  }

  /** CSV出力パネルを描画する */
  function renderCsvExportPanel(results, stocks) {
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: 'CSV出力' }),
      createElement('p', { class: 'desc', text: '月次の詳細データ（銘柄別内訳・為替レート等）をCSVファイルとして書き出します。詳細データは試行#1と、失敗試行の先頭（設定した保存上限件数）のみ保持されています。' })
    ]);
    const btnFailed = createElement('button', {
      class: 'btn', text: '失敗試行をまとめてCSV出力',
      onclick: () => {
        const r = FireCsv.exportFailedTrials(results, stocks);
        showToast(r.success ? (r.rowCount + '行を出力しました') : r.message, 4000);
      }
    });
    const btnFirst = createElement('button', {
      class: 'btn', text: '試行#1をCSV出力',
      onclick: () => {
        const r = FireCsv.exportSingleTrial(results[0], stocks);
        showToast(r.success ? (r.rowCount + '行を出力しました') : r.message, 4000);
      }
    });
    panel.appendChild(createElement('div', { class: 'row-actions' }, [btnFailed, btnFirst]));
    return panel;
  }

  // =====================================================
  // 試行一覧（成功／失敗の絞り込み・最終資産ソート・毎月データ表示）
  // =====================================================

  /** 月インデックス（0始まり）を "0年1月" 形式の文字列に変換する（エンジン側の yearMonth 表記と揃える） */
  function formatYearMonthLabel(monthIndex) {
    return Math.floor(monthIndex / 12) + '年' + ((monthIndex % 12) + 1) + '月';
  }

  /** 1試行の最終月の総資産を取得する（lightHistoryは全試行で保持されているため常に取得できる） */
  function getTrialFinalAsset(trial) {
    if (trial.lightHistory.length === 0) return 0;
    return trial.lightHistory[trial.lightHistory.length - 1].totalAsset;
  }

  /**
   * 2つの試行の「良し悪し」を比較する（負値: aの方が悪い/少ない、正値: aの方が良い/多い）。
   * 成功試行同士は最終資産で比較する。失敗試行同士は「失敗までの期間が短いほど悪い
   * （＝最終資産が少ないとみなす）」というユーザー指定のルールで比較する
   * （失敗後は資産が0円で記録されるため、最終資産そのものでは優劣が付けられないため）。
   * 成功と失敗の間では、常に成功試行の方が良いとみなす。
   */
  function compareTrialsAscending(a, b) {
    if (a.success && b.success) return getTrialFinalAsset(a) - getTrialFinalAsset(b);
    if (!a.success && !b.success) return a.failureMonth - b.failureMonth;
    return a.success ? 1 : -1; // 成功 > 失敗
  }

  /**
   * 試行一覧パネル（絞り込み・ソート・毎月データ表示）を描画する。
   * 左側に試行一覧（番号／最終資産・破綻時期のみの簡易テーブル）、
   * 右側に選択中の試行のグラフ・詳細データを並べる2カラムレイアウトにする
   * （一覧をスクロールしながら詳細を見比べやすくするため）。
   * 左の一覧の高さは、右側（グラフ・毎月データ・CSV出力ボタンまで）の実際の
   * 描画後の高さに、JSで動的に合わせる（下記 syncTrialListHeightToRightColumn 参照）。
   */
  function renderTrialListPanel(results, stocks) {
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '試行別 結果一覧・月次詳細' }),
      createElement('p', {
        class: 'desc',
        text: '各試行の最終資産で並び替え・絞り込みができます。左の一覧から行を選択すると、右側にその試行の毎月のデータを表示します。'
      })
    ]);

    const controlsContainer = createElement('div', { id: 'trial-list-controls' });
    const listContainer = createElement('div', { id: 'trial-list-container' });
    const detailContainer = createElement('div', { id: 'trial-detail-container' });

    const leftColumn = createElement('div', { class: 'trial-panel-left' }, [controlsContainer, listContainer]);
    const rightColumn = createElement('div', { class: 'trial-panel-right' }, [detailContainer]);
    panel.appendChild(createElement('div', { class: 'trial-panel-layout' }, [leftColumn, rightColumn]));

    trialListPanelRefs = { results, stocks, controlsContainer, listContainer, detailContainer, rightColumn };

    renderTrialListControls(controlsContainer, results, stocks, listContainer, detailContainer, rightColumn);
    renderTrialListTable(listContainer, results, stocks, detailContainer, rightColumn);

    return panel;
  }

  /**
   * 左カラムの試行一覧（.trial-list-scroll）の高さを、右カラム（グラフ・毎月データ・
   * 「この試行をCSV出力」ボタンまで）の実際の描画後の高さに合わせる。
   * 画面幅が狭く縦積みレイアウトになっている場合（CSS側のブレークポイントと合わせて800px以下）は、
   * 高さを固定する必要がないため、明示的に指定したインラインスタイルを解除して通常表示に戻す。
   */
  function syncTrialListHeightToRightColumn(listScrollElement, rightColumnElement) {
    if (!listScrollElement || !rightColumnElement) return;

    const isStackedLayout = window.innerWidth <= 800;
    if (isStackedLayout) {
      // 縦積みレイアウトでは、CSS側の通常の高さ上限（max-height:420px）に戻す
      listScrollElement.style.height = '';
      listScrollElement.style.maxHeight = '';
      return;
    }

    const targetHeight = rightColumnElement.offsetHeight;
    if (targetHeight > 0) {
      // CSSのmax-height指定より優先させるため、maxHeightも合わせて上書きする
      listScrollElement.style.maxHeight = 'none';
      listScrollElement.style.height = targetHeight + 'px';
    }
  }

  /**
   * 絞り込みボタン・ソート切り替えボタンの行を描画する。
   * ボタンのラベル（ソート方向）やハイライト状態（選択中フィルタ）は状態が変わるたびに
   * 見た目に反映する必要があるため、状態変更のたびにこの関数ごと再描画する。
   */
  function renderTrialListControls(controlsContainer, results, stocks, listContainer, detailContainer, rightColumn) {
    controlsContainer.innerHTML = '';

    const applyStateChange = () => {
      renderTrialListControls(controlsContainer, results, stocks, listContainer, detailContainer, rightColumn);
      renderTrialListTable(listContainer, results, stocks, detailContainer, rightColumn);
    };

    const makeFilterBtn = (value, label) => createElement('button', {
      class: 'btn btn-sm' + (trialListFilter === value ? ' btn-primary' : ''),
      text: label,
      onclick: () => { trialListFilter = value; applyStateChange(); }
    });

    const sortBtn = createElement('button', {
      class: 'btn btn-sm',
      text: trialListSortDir === 'asc' ? '最終資産: 少ない順↑' : '最終資産: 多い順↓',
      onclick: () => { trialListSortDir = trialListSortDir === 'asc' ? 'desc' : 'asc'; applyStateChange(); }
    });

    controlsContainer.appendChild(createElement('div', { class: 'trial-select' }, [
      makeFilterBtn('all', 'すべて'),
      makeFilterBtn('success', '成功のみ'),
      makeFilterBtn('failure', '失敗のみ'),
      sortBtn
    ]));
  }

  /**
   * 試行一覧テーブル内の行のハイライト表示を、選択中の試行(selectedTrialId)に合わせて
   * 更新する。テーブル自体を再構築しないため、一覧の縦スクロール位置は保持される。
   */
  function highlightSelectedTrialRow(container) {
    container.querySelectorAll('tr[data-trial-id]').forEach((row) => {
      const isSelected = row.getAttribute('data-trial-id') === String(selectedTrialId);
      row.style.background = isSelected ? 'rgba(255,138,61,0.12)' : '';
    });
  }

  /** 絞り込み・並び替え条件に従って試行一覧テーブルを描画する */
  function renderTrialListTable(container, results, stocks, detailContainer, rightColumn) {
    container.innerHTML = '';

    let filtered = results;
    if (trialListFilter === 'success') filtered = results.filter((r) => r.success);
    if (trialListFilter === 'failure') filtered = results.filter((r) => !r.success);

    const sorted = filtered.slice().sort((a, b) =>
      trialListSortDir === 'asc' ? compareTrialsAscending(a, b) : -compareTrialsAscending(a, b));

    // 左カラムに収める簡易一覧のため、列は「番号」「最終資産／破綻時期」の2列のみとする
    // （ステータス・詳細データの有無は、右側の詳細表示を見れば分かるため一覧には含めない）
    const table = createElement('table', { class: 'data-table' });
    table.appendChild(createElement('thead', {}, [
      createElement('tr', {}, ['番号', '最終資産／破綻時期'].map((h) => createElement('th', { text: h })))
    ]));
    const tbody = createElement('tbody');

    sorted.forEach((trial) => {
      const isSelected = trial.trialId === selectedTrialId;
      const row = createElement('tr', {
        'data-trial-id': String(trial.trialId),
        style: 'cursor:pointer;' + (isSelected ? 'background:rgba(255,138,61,0.12);' : ''),
        onclick: () => {
          selectedTrialId = trial.trialId;
          // 一覧全体を再描画するとスクロール位置が失われるため、ハイライトの
          // 付け替えのみをその場で行い、テーブル自体は再構築しない
          highlightSelectedTrialRow(container);
          renderSelectedTrialDetail(detailContainer, trial, stocks);
          syncTrialListHeightToRightColumn(listScrollElement, rightColumn);
        }
      }, [
        createElement('td', { text: '#' + trial.trialId }),
        createElement('td', {
          text: trial.success
            ? formatYen(getTrialFinalAsset(trial))
            : '破綻（' + (trial.failureMonth / 12).toFixed(1) + '年目）'
        })
      ]);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    const listScrollElement = createElement('div', { class: 'table-scroll trial-list-scroll' }, [table]);
    container.appendChild(listScrollElement);

    if (sorted.length === 0) {
      container.appendChild(createElement('p', { class: 'help-text', text: '（該当する試行がありません）' }));
    }

    // まだ何も選択されていなければ、一覧の先頭の試行を自動的に選択して表示する
    if (selectedTrialId === null && sorted.length > 0) {
      selectedTrialId = sorted[0].trialId;
      renderSelectedTrialDetail(detailContainer, sorted[0], stocks);
    } else if (selectedTrialId !== null) {
      const stillSelected = sorted.find((t) => t.trialId === selectedTrialId);
      if (stillSelected) renderSelectedTrialDetail(detailContainer, stillSelected, stocks);
    }

    // 右カラム（グラフ・毎月データ・CSV出力ボタンまで）の描画が終わった直後の高さに、
    // 左の一覧の高さを合わせる
    syncTrialListHeightToRightColumn(listScrollElement, rightColumn);
  }

  /** 選択された1試行の詳細（毎月のデータ）を描画する。内訳データの有無に応じて表示内容を切り替える */
  function renderSelectedTrialDetail(container, trial, stocks) {
    container.innerHTML = '';
    container.appendChild(createElement('h2', { text: '試行#' + trial.trialId + ' の毎月データ（' + (trial.success ? '成功' : '失敗') + '）' }));

    if (trial.history.length > 0) {
      container.appendChild(createElement('p', {
        class: 'desc',
        text: 'この試行は内訳（収入・出費・税金・銘柄別評価額など）を含む詳細データを保持しています。' +
          '行をクリックすると、その月の各口座・銘柄の内訳（資産額・保有口数・現在価額・平均取得価額・含み損益率）と' +
          '為替レートを別ウィンドウで表示します。'
      }));
      container.appendChild(renderStockCompositionChartPanel(trial, stocks));
      renderTrialMonthlyTableFull(container, trial, stocks);

      const csvBtn = createElement('button', {
        class: 'btn btn-sm', text: 'この試行をCSV出力',
        onclick: () => {
          const r = FireCsv.exportSingleTrial(trial, stocks);
          showToast(r.success ? (r.rowCount + '行を出力しました') : r.message, 4000);
        }
      });
      container.appendChild(createElement('div', { class: 'row-actions' }, [csvBtn]));
    } else {
      container.appendChild(createElement('p', {
        class: 'desc',
        text: 'この試行はメモリ節約のため、月次の総資産・現金の推移のみ保持しています' +
          '（内訳の詳細データは試行#1と、失敗試行の一部にのみ保持されます。基本設定タブの「失敗試行の詳細保存上限」で保持件数を増やせます）。'
      }));
      renderTrialMonthlyTableLight(container, trial);
    }
  }

  /** 銘柄ごとの資産推移を積み上げグラフで表示するパネルを構築する（凡例つき） */
  function renderStockCompositionChartPanel(trial, stocks) {
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '銘柄別 資産構成の推移（積み上げグラフ）' }),
      createElement('p', {
        class: 'desc',
        text: 'この試行における、各銘柄の評価額を月ごとに積み上げて表示します（現金は含みません）。' +
          '右軸の折れ線は、各年1月時点の年間生活費が、その時点の全体資産の何%に相当するかを示します。'
      })
    ]);

    const months = trial.history.map((record, i) => i);
    const seriesList = stocks.map((stock, stockIndex) => ({
      name: stock.meigara,
      values: trial.history.map((record) => (record.stockDetails[stockIndex] ? record.stockDetails[stockIndex].value : 0))
    }));
    const percentSeries = buildLifeCostRatioSeries(trial);

    const chartWrap = createElement('div', { class: 'chart-wrap' });
    const canvas = createElement('canvas', { style: 'width:100%; height:280px; display:block;' });
    chartWrap.appendChild(canvas);
    panel.appendChild(chartWrap);

    // 凡例（銘柄名と色の対応）。canvas内に文字で描くと銘柄数が多いと読みづらいためDOMで別途表示する
    const legendItems = stocks.map((stock, i) =>
      createElement('span', { class: 'chart-legend-item' }, [
        createElement('span', { class: 'chart-legend-swatch', style: 'background:' + FireChart.seriesColor(i, seriesList.length) }),
        createElement('span', { text: stock.meigara })
      ]));
    if (percentSeries.length > 0) {
      legendItems.push(createElement('span', { class: 'chart-legend-item' }, [
        createElement('span', { class: 'chart-legend-swatch', style: 'background:#4fd1c5' }),
        createElement('span', { text: '生活費/資産 比率（右軸・各年1月）' })
      ]));
    }
    panel.appendChild(createElement('div', { class: 'chart-legend' }, legendItems));

    requestAnimationFrame(() => FireChart.drawStackedAssetChart(canvas, months, seriesList, percentSeries));

    return panel;
  }

  /**
   * 各年1月時点（monthIndexが12の倍数の月）について、年間生活費が全体資産に占める
   * 割合（%）を計算する。年間生活費は、その時点の月次生活費（インフレ適用後）を
   * 12倍した概算値（次の1月まで月次生活費は変わらないため、この近似で問題ない）。
   * 全体資産が0以下の月は比率が定義できないためスキップする。
   */
  function buildLifeCostRatioSeries(trial) {
    const series = [];
    trial.history.forEach((record, monthIndex) => {
      if (monthIndex % 12 !== 0) return;
      if (!(record.totalAsset > 0)) return;
      const annualLifeCost = record.monthlyLifeCost * 12;
      series.push({ monthIndex, percent: (annualLifeCost / record.totalAsset) * 100 });
    });
    return series;
  }

  /**
   * 内訳データ（history）を持つ試行の毎月データを、全期間分・省略なしで表形式表示する。
   * 各行はクリック可能にし、クリックするとその月の各口座・銘柄の内訳を別ウィンドウで表示する。
   */
  function renderTrialMonthlyTableFull(container, trial, stocks) {
    const table = createElement('table', { class: 'data-table' });
    table.appendChild(createElement('thead', {}, [
      createElement('tr', {}, ['年月', '総資産', '現金', '投資資産', '収入', '出費', '税金', 'isFailure'].map((h) => createElement('th', { text: h })))
    ]));
    const tbody = createElement('tbody');
    trial.history.forEach((record) => {
      tbody.appendChild(createElement('tr', {
        style: 'cursor:pointer;',
        title: 'クリックすると、この月の各口座・銘柄の内訳を別ウィンドウで表示します',
        onclick: () => openMonthDetailWindow(trial, record, stocks)
      }, [
        createElement('td', { text: record.yearMonth }),
        createElement('td', { text: formatYen(record.totalAsset) }),
        createElement('td', { text: formatYen(record.cash) }),
        createElement('td', { text: formatYen(record.endOfPeriodAssets) }),
        createElement('td', { text: formatYen(record.income) }),
        createElement('td', { text: formatYen(record.expense) }),
        createElement('td', { text: formatYen(record.tax) }),
        createElement('td', { text: record.isFailure ? 'TRUE' : 'FALSE' })
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(createElement('div', { class: 'table-scroll monthly-table-scroll' }, [table]));
  }

  // =====================================================
  // 月次内訳の別ウィンドウ表示（為替レート・各口座銘柄の内訳）
  // =====================================================

  /** HTML特殊文字をエスケープする（銘柄名など、ユーザーが自由入力した文字列を別ウィンドウのHTMLへ安全に埋め込むため） */
  function escapeHtmlText(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 符号付きパーセント文字列を生成する（正の値には+を付ける。例: "+12.3%" "-8.5%"） */
  function formatSignedPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(1) + '%';
  }

  /**
   * 為替ペアごとの「その月のレート」と「シミュレーション開始時点（history先頭月）からの
   * 増減率」を計算する（Android版 SimulationScreen.kt の calculateFailureTableFxRow と
   * 同じ計算式: (rate - startRate) / startRate * 100）。
   */
  function buildFxSummaryRows(trial, record) {
    const startRates = (trial.history.length > 0 && trial.history[0].fxRates) ? trial.history[0].fxRates : {};
    return Object.keys(record.fxRates || {}).map((pair) => {
      const rate = record.fxRates[pair];
      const startRate = startRates[pair];
      const changePercent = (startRate !== undefined && startRate !== 0) ? ((rate - startRate) / startRate) * 100 : null;
      return { pair, rate, changePercent };
    });
  }

  /** 為替ペア1件分の表示行を "USD/JPY 130.00(-20.0%)" 形式の文字列に整形する */
  function formatFxSummaryLine(fxRow) {
    const ratePart = fxRow.rate.toFixed(2);
    const changePart = fxRow.changePercent === null ? '開始時点データなし' : formatSignedPercent(fxRow.changePercent);
    return fxRow.pair + ' ' + ratePart + '(' + changePart + ')';
  }

  /**
   * その月の各銘柄（口座）の内訳（資産額・保有口数・現在価額・平均取得価額・含み損益率）を組み立てる。
   * 含み損益率は (現在価額 - 平均取得価額) / 平均取得価額 × 100 で計算する（正なら含み益、負なら含み損）。
   * 保有口数が0、または平均取得価額が0以下の銘柄は損益率を計算できないため "-" とする。
   */
  function buildStockBreakdownRows(record, stocks) {
    return stocks.map((stock, index) => {
      const detail = record.stockDetails ? record.stockDetails[index] : null;
      if (!detail) return null;
      const canCalculateGainRate = detail.kuchisu > 0 && detail.averagePrice > 0;
      const gainRate = canCalculateGainRate
        ? ((detail.currentValuePerUnit - detail.averagePrice) / detail.averagePrice) * 100
        : null;
      return {
        meigara: stock.meigara,
        value: detail.value,
        kuchisu: detail.kuchisu,
        currentValuePerUnit: detail.currentValuePerUnit,
        averagePrice: detail.averagePrice,
        gainRate
      };
    }).filter((row) => row !== null);
  }

  /** 為替レート一覧セクションのHTML断片を組み立てる（対象ペアが1つもない場合は空文字を返す） */
  function buildFxSummarySectionHtml(fxRows) {
    if (fxRows.length === 0) return '';
    const lines = fxRows.map((row) => '<div>' + escapeHtmlText(formatFxSummaryLine(row)) + '</div>').join('');
    return '<h3 style="font-size:14px;margin:0 0 8px;">為替レート（開始時点からの増減率）</h3>' +
      '<div style="margin-bottom:18px;font-size:13px;line-height:1.9;">' + lines + '</div>';
  }

  /**
   * 現金・国債の状況セクションのHTML断片を組み立てる。
   * 「国債」は2種類扱っていることに注意: ①現金/国債バッファ戦略で保有する個人向け国債
   * （jgbBufferValue/jgbBufferLotCount）、②保有債券タブで個別に登録した債券
   * （bondStatuses。満期を迎えていれば「満期償還済み」、まだなら「保有中」と表示する）。
   */
  function buildCashAndBondSectionHtml(record) {
    const parts = [];
    parts.push('<div style="margin:4px 0 6px;font-size:13px;">現金: <b>' + escapeHtmlText(formatYen(record.cash)) + '</b></div>');

    if (record.jgbBufferLotCount > 0) {
      parts.push('<div style="margin:0 0 12px;font-size:13px;">現金/国債バッファの国債: <b>' +
        record.jgbBufferLotCount + '口</b>（評価額 ' + escapeHtmlText(formatYen(record.jgbBufferValue)) + '）</div>');
    }

    if (record.bondStatuses && record.bondStatuses.length > 0) {
      const headerCells = ['銘柄名', '額面×保有数', '利率', '満期年月', '状態'].map((h) => '<th>' + h + '</th>').join('');
      const bodyRows = record.bondStatuses.map((b) => {
        const totalFace = b.faceValue * b.quantity;
        const statusText = b.isMatured ? '満期償還済み' : '保有中';
        const statusColor = b.isMatured ? 'var(--color-text-dim)' : 'var(--color-success)';
        return '<tr>' +
          '<td>' + escapeHtmlText(b.name) + '</td>' +
          '<td>' + escapeHtmlText(formatYen(totalFace)) + '（' + b.quantity + '口）</td>' +
          '<td>' + b.couponRate.toFixed(2) + '%</td>' +
          '<td>' + escapeHtmlText(b.maturityYM) + '</td>' +
          '<td style="color:' + statusColor + ';">' + statusText + '</td>' +
          '</tr>';
      }).join('');
      parts.push('<div class="table-scroll"><table class="data-table"><thead><tr>' + headerCells + '</tr></thead>' +
        '<tbody>' + bodyRows + '</tbody></table></div>');
    }

    return '<h3 style="font-size:14px;margin:16px 0 8px;">現金・国債の状況</h3>' + parts.join('');
  }

  /** 各口座・銘柄の内訳テーブルのHTML断片を組み立てる */
  function buildStockBreakdownSectionHtml(stockRows) {
    const headerCells = ['銘柄名＜口座種別＞', '資産額', '保有口数', '現在価額', '平均取得価額', '含み損益率']
      .map((h) => '<th>' + h + '</th>').join('');

    const bodyRows = stockRows.map((row) => {
      const gainCellText = escapeHtmlText(formatSignedPercent(row.gainRate));
      const gainCellColor = row.gainRate === null ? '' : (row.gainRate >= 0 ? 'var(--color-success)' : 'var(--color-danger)');
      const gainCellStyle = gainCellColor ? ' style="color:' + gainCellColor + ';"' : '';
      return '<tr>' +
        '<td>' + escapeHtmlText(row.meigara) + '</td>' +
        '<td>' + escapeHtmlText(formatYen(row.value)) + '</td>' +
        '<td>' + Math.round(row.kuchisu).toLocaleString('ja-JP') + '口</td>' +
        '<td>' + escapeHtmlText(formatYen(row.currentValuePerUnit)) + '</td>' +
        '<td>' + escapeHtmlText(formatYen(row.averagePrice)) + '</td>' +
        '<td' + gainCellStyle + '>' + gainCellText + '</td>' +
        '</tr>';
    }).join('');

    return '<h3 style="font-size:14px;margin:16px 0 8px;">各口座・銘柄の内訳</h3>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr>' + headerCells + '</tr></thead>' +
      '<tbody>' + bodyRows + '</tbody></table></div>';
  }

  /** 別ウィンドウ全体（HTML文書）を組み立てる。このアプリと同じスタイルシート（css/style.css）を読み込み、見た目を統一する */
  function buildMonthDetailHtml(trial, record, fxRows, stockRows) {
    const title = '試行#' + trial.trialId + ' ' + record.yearMonth + ' の内訳';
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<title>' + escapeHtmlText(title) + '</title>' +
      '<link rel="stylesheet" href="css/style.css"></head>' +
      '<body><main class="tab-content" style="max-width:820px;">' +
      '<div class="panel">' +
      '<h2>' + escapeHtmlText(title) + '</h2>' +
      buildFxSummarySectionHtml(fxRows) +
      buildCashAndBondSectionHtml(record) +
      buildStockBreakdownSectionHtml(stockRows) +
      '</div></main></body></html>';
  }

  // 月次内訳を表示する別ウィンドウの固定名。window.open()に毎回同じ名前を渡すことで、
  // 既に開いているウィンドウがあればそれが再利用（内容が差し替わるだけ）され、
  // 行をクリックするたびに新しいウィンドウが増え続けることを防ぐ。
  const MONTH_DETAIL_WINDOW_NAME = 'fireMonthDetailWindow';

  /**
   * 毎月データテーブルの1行がクリックされたときに呼ばれる。その月の為替レート・各口座銘柄の
   * 内訳を、このアプリとは別のブラウザウィンドウに表示する。ウィンドウは固定名で開くため、
   * 何度クリックしても同じ1つのウィンドウの中身が更新される。
   * ポップアップがブロックされた場合は、その旨をトーストで案内する。
   */
  function openMonthDetailWindow(trial, record, stocks) {
    const newWindow = window.open('', MONTH_DETAIL_WINDOW_NAME, 'width=860,height=760');
    if (!newWindow) {
      showToast('ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。', 4000);
      return;
    }

    const fxRows = buildFxSummaryRows(trial, record);
    const stockRows = buildStockBreakdownRows(record, stocks);
    const html = buildMonthDetailHtml(trial, record, fxRows, stockRows);

    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
    newWindow.focus();
  }


  /** 内訳データを持たない試行（総資産・現金のみ）の毎月データを、全期間分・省略なしで表形式表示する */
  function renderTrialMonthlyTableLight(container, trial) {
    const table = createElement('table', { class: 'data-table' });
    table.appendChild(createElement('thead', {}, [
      createElement('tr', {}, ['年月', '総資産', '現金', '投資資産', 'isFailure'].map((h) => createElement('th', { text: h })))
    ]));
    const tbody = createElement('tbody');
    trial.lightHistory.forEach((record, i) => {
      tbody.appendChild(createElement('tr', {}, [
        createElement('td', { text: formatYearMonthLabel(i) }),
        createElement('td', { text: formatYen(record.totalAsset) }),
        createElement('td', { text: formatYen(record.cash) }),
        createElement('td', { text: formatYen(record.investmentAssets) }),
        createElement('td', { text: record.isFailure ? 'TRUE' : 'FALSE' })
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(createElement('div', { class: 'table-scroll monthly-table-scroll' }, [table]));
  }

  global.FireUiSimulation = { renderTabRun };
})(typeof window !== 'undefined' ? window : globalThis);
