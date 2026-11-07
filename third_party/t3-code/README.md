# T3 Code adaptations

OpenMausBot adapts code from [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
under the MIT license in this directory. See the repository's NOTICE for the
integrations that use it.

The response presentation port was retrieved on 2026-11-06 from:

- `apps/web/src/components/chat/MarkdownCodeBlock.tsx`: compact frame and header.
- `apps/web/src/components/chat/MarkdownDetails.tsx`: disclosure layout.
- `apps/web/src/components/ChatMarkdown.tsx`: GitHub callout presentation.
- `apps/web/src/components/ContextChip.tsx`: inline file label presentation.
- `apps/web/src/index.css`: Markdown typography, lists, quotes, inline code and
  table presentation.

The port uses OpenMausBot theme tokens, native disclosures, clipboard controls,
table operations, file access and rendering security in place of T3 Code's
application integrations. It does not depend on T3 Code's application state or
provider runtime.
