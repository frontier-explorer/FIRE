// gulp-terser（JavaScriptの高速縮小化・ほどほどの難読化）
// gulp-clean-css（CSS縮小化）
// gulp-htmlmin（HTML縮小化）
const { src, dest, series } = require('gulp');
const terser = require('gulp-terser');
const cleanCSS = require('gulp-clean-css');
const htmlmin = require('gulp-htmlmin');

// ===============================================
// 速度最優先のJavaScript縮小化オプションを定義
// ===============================================
const SPEED_OPTIMIZED_TERSER_OPTIONS = {
    // 圧縮設定: 速度とコードサイズを最適化する最も安全な設定
    compress: {
        dead_code: true,       // 到達不能なコードを削除
        drop_console: true,    // console.log()を削除
        unused: true,          // 未使用の変数を削除
        reduce_vars: true,     // 変数の使用を最適化
        if_return: true,       // if/return構造を最適化
        sequences: true,       // 連続する式を最適化
        comparisons: true,     // 比較演算子の最適化
    },
    // 難読化設定: 性能に影響の少ないローカルスコープに限定
    mangle: {
        // 💡 難読化が原因で問題を起こしやすかったグローバルスコープの変数名の変更を停止し、速度を確保
        toplevel: false, 
        // 重要なグローバル変数（例: appData）の名前は保持
        reserved: ['appData'] 
    },
    // 出力設定
    output: {
        comments: false, // コメントをすべて削除
        ascii_only: true // ASCII文字以外をUnicodeエスケープ
    }
};

// ===============================================
// 1. 外部JavaScript（app.js, simulate-logic.jsなど）の処理
// ===============================================
function jsMinify() {
    return src(['*.js', '!*.min.js'])
        .pipe(terser(SPEED_OPTIMIZED_TERSER_OPTIONS)) // 速度最適化オプションを使用
        .pipe(dest('dist/'));
}

// ===============================================
// 2. CSSの縮小化タスク
// ===============================================
function cssMinify() {
    return src('*.css') 
        .pipe(cleanCSS()) 
        .pipe(dest('dist/'));
}

// ===============================================
// 3. HTMLの縮小化タスク (インラインJSにも高速設定を適用)
// ===============================================
function htmlMinify() {
    return src('*.html')
        .pipe(htmlmin({
            collapseWhitespace: true,
            removeComments: true,
            // インラインJSにも速度最適化オプションを適用
            minifyJS: SPEED_OPTIMIZED_TERSER_OPTIONS, 
            minifyCSS: true,
            removeTagWhitespace: true,
            removeOptionalTags: true,
            removeRedundantAttributes: true
        }))
        .pipe(dest('dist/'));
}

// ===============================================
// 4. 既に縮小化済みのファイルをコピーするタスク (chart.min.jsなど)
// ===============================================
function copyMinifiedAssets() {
    return src('*.min.js')
        .pipe(dest('dist/'));
}

// ===============================================
// ビルドタスクの定義
// ===============================================
exports.default = series(jsMinify, cssMinify, htmlMinify, copyMinifiedAssets);