# Vendored dependencies

`zot ext install` copies the extension directory and never runs `npm install`,
so the markdown converter ships its runtime code here.

| Package     | Version | Copied from                              |
| ----------- | ------- | ---------------------------------------- |
| marked      | 15.0.12 | `node_modules/marked/lib/marked.esm.js`  |
| marked-jira | 1.0.1   | `node_modules/marked-jira/lib/index.esm.js` |

The `marked-jira` copy drops its bare `import 'marked';`: the vendored files
are loaded directly and bare specifiers do not resolve. Licenses sit next to
the code. To update, install the exact versions pinned in `package.json`, copy
both files again, drop the import, and refresh this table.
