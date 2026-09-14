// The inline-`type` specifier form. `scanImports()` elides it exactly as it
// elides `import type … from`, and the backstop regex requires the `type`
// keyword *before* the clause — so this shape reached packages/core through
// the gap between the two mechanisms.
import { type Root, type Content } from 'mdast';

export type Doc = Root;
export type Piece = Content;
