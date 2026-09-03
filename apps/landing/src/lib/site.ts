/**
 * Static marketing metadata for apps/landing. Phase 0 scope is a smoke
 * page proving the Astro shell boots and coexists with Nuxt in this
 * workspace (see design.md "Nuxt 4 + Astro Coexistence") — the real
 * marketing copy and page design are future work.
 */
export interface SiteMetadata {
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
}

export const site: SiteMetadata = {
  name: 'deep-wiki',
  tagline: 'A self-hosted wiki for software teams and AI agents.',
  description:
    "Teams arrive with a raw idea; deep-wiki interrogates it with AI until it becomes a well-declared design document, and the resulting corpus becomes the team's single source of truth and a RAG surface agents can query.",
};
