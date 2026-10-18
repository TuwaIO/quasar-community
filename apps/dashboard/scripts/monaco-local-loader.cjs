// Build-time loader (next.config.mjs, `turbopack.rules`) for the client code of @payloadcms/ui. Payload bundles
// its own copy of @monaco-editor/loader, which loads Monaco, the code editor of JSON and code fields, from jsDelivr;
// `loader.config()` of the @monaco-editor/loader package cannot reach that copy. The loader rewrites its address to
// public/monaco/vs, which scripts/copy-monaco.mjs fills with the same Monaco version before `next dev` and `next build`.

/** The jsDelivr address of Monaco's AMD build, with the version Payload pins. */
const monacoCdn = /https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor/;
const monacoCdnBase = /https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[^/"'`\s]+\/min\/vs/g;

/**
 * The files the rule applies to, by project-relative path: the build of @payloadcms/ui and the @monaco-editor/loader
 * package (its default address; MonacoLocalProvider also configures it at runtime).
 */
const monacoLoaderFiles = /(@payloadcms\/ui\/dist|@monaco-editor\/loader\/lib)\//;

/**
 * @param {string} source - A file of the @payloadcms/ui build or of the @monaco-editor/loader package.
 * @returns {string} The file with Monaco loaded from this site.
 * @throws {Error} When the file still refers to Monaco on jsDelivr after the rewrite, so a new Payload version fails
 *   the build instead of loading Monaco from a third party.
 */
function rewriteMonacoBase(source) {
  const rewritten = source.replace(monacoCdnBase, '/monaco/vs');
  if (monacoCdn.test(rewritten)) {
    throw new Error(
      'monaco-local-loader: @payloadcms/ui loads Monaco from jsDelivr in a form this loader does not rewrite',
    );
  }
  return rewritten;
}

/** @param {string} source */
module.exports = function monacoLocalLoader(source) {
  return rewriteMonacoBase(source);
};
module.exports.rewriteMonacoBase = rewriteMonacoBase;
module.exports.monacoLoaderFiles = monacoLoaderFiles;
module.exports.monacoCdn = monacoCdn;
