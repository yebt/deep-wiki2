<script setup lang="ts">
/**
 * The new-thread composer inside the thread panel: what the thread is
 * about (the selected text, or the whole block), a labelled textarea with
 * `@` mentions, **Post** and **Cancel**. The state lives in `useNewThread`
 * on the screen; this draws it and owns only the mention menu's own
 * moment-to-moment state, which nothing outside the textarea needs.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2): a member with `comment`
 * who just pressed a block's "+" or a selection's "Comment"; "say
 * something about this paragraph"; the single primary action is Post;
 * the data is the excerpt the screen captured and the person's own text;
 * it does not reply, resolve or edit; with nothing typed Post explains
 * itself, and a long comment is the textarea's own scroll.
 *
 * ## Ground, type, rhythm
 *
 * A thread's own card (`CommentThreadItem`): `bg-default` at the
 * container radius inside the `bg-accented` panel, the excerpt as §2.3's
 * blockquote, one field group with §7.4's 8px label gap, 16px above the
 * actions. Post is Filled — the panel's one primary action (§9.1) —
 * beside an Outlined Cancel, which is the pair §9.1 names for a Cancel
 * next to a Filled action. Both stay in the tab order while unavailable
 * (`aria-disabled`, §5) and say why on hover and focus (§3).
 *
 * ## Mentions
 *
 * `@` at the start or after a space opens `MentionMenu` — the editor's
 * own menu, one component (§4.1) — under the field, driven by
 * `utils/mention-trigger.ts` rather than the ProseMirror plugin, so the
 * read path never loads the editor chunk (`bundle-isolation.ts`).
 * Keyboard-first (§4.6): arrows move, Enter confirms, Escape dismisses,
 * Tab dismisses and moves on. People only: a comment's mention
 * notifies a person (comment-threads spec), and a page has no inbox.
 * A confirmed mention is checked against `can()` the way the editor's
 * is ("Mentioning A User Does Not Silently Grant Them Access"), and the
 * answer is a chip-tier notice under the field.
 *
 * ## Failure
 *
 * The panel shows the write failure as its bar notice; the text stays in
 * the field (`useNewThread` never clears it on failure) and the notice
 * says so (§3, "says explicitly whether the work was lost or preserved").
 */
import type { MentionCandidate } from '@deep-wiki/editor';
import type { NewThreadStatus, NewThreadTarget } from '~/composables/useNewThread';
import { insertMention, mentionQueryAt, type ConfirmedMention, type MentionQuery } from '~/utils/mention-trigger';

const props = defineProps<{
  target: NewThreadTarget;
  status: NewThreadStatus;
  workspaceId: string;
  pageId: string;
}>();

const body = defineModel<string>('body', { required: true });
const mentions = defineModel<ConfirmedMention[]>('mentions', { required: true });

const emit = defineEmits<{ post: []; cancel: [] }>();

const posting = computed(() => props.status === 'posting');
const canPost = computed(() => !posting.value && body.value.trim().length > 0);
const postReason = computed(() => (posting.value ? 'Posting your comment…' : canPost.value ? undefined : 'Write a comment first.'));

const headingId = useId();
const menuId = useId();
const optionIdPrefix = `${menuId}-option-`;

const textarea = useTemplateRef<{ textareaRef: HTMLTextAreaElement | Ref<HTMLTextAreaElement | null> | null }>('textarea');
/** The real `<textarea>` under `UTextarea` — `defineExpose`d as a ref, which the instance proxy does not always unwrap. */
function element(): HTMLTextAreaElement | null {
  return unref(textarea.value?.textareaRef) ?? null;
}

const { search, checkAccess } = useMentionCandidates(props.workspaceId, props.pageId);

const activeQuery = ref<MentionQuery | null>(null);
const candidates = ref<MentionCandidate[]>([]);
const selectedIndex = ref(0);
const mismatch = ref<string | null>(null);
let lastSearched: string | null = null;

const menuOpen = computed(() => activeQuery.value !== null);
const activeOptionId = computed(() => (menuOpen.value && candidates.value.length > 0 ? `${optionIdPrefix}${selectedIndex.value}` : undefined));

/**
 * Re-reads the `@` query at the caret after anything that moves the caret
 * or changes the text. Reads the element, not the model: on `input` the
 * model is still one tick behind what was typed.
 */
function refreshQuery(): void {
  const el = element();
  if (!el) return;
  const next = mentionQueryAt(el.value, el.selectionStart ?? el.value.length);
  if (!next) {
    activeQuery.value = null;
    candidates.value = [];
    lastSearched = null;
    return;
  }
  activeQuery.value = next;
  if (next.query !== lastSearched) {
    lastSearched = next.query;
    const query = next.query;
    selectedIndex.value = 0;
    void search(query).then((found) => {
      if (lastSearched !== query) return;
      candidates.value = found.filter((candidate) => candidate.type === 'user');
    });
  }
}

function dismissMenu(): void {
  activeQuery.value = null;
  candidates.value = [];
  lastSearched = null;
}

function confirmAt(index: number): void {
  const candidate = candidates.value[index];
  const query = activeQuery.value;
  const el = element();
  if (!candidate || !query || !el) return;
  const inserted = insertMention(el.value, query, candidate.label);
  body.value = inserted.text;
  mentions.value = [...mentions.value, { id: candidate.id, label: candidate.label }];
  dismissMenu();
  nextTick(() => {
    el.focus();
    el.setSelectionRange(inserted.caret, inserted.caret);
  });
  void checkAccess(candidate.id).then((canRead) => {
    mismatch.value = canRead ? null : `${candidate.label} does not have access to this page yet — mentioning them does not grant it.`;
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (menuOpen.value) {
    if (event.key === 'ArrowDown' && candidates.value.length > 0) {
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value + 1) % candidates.value.length;
      return;
    }
    if (event.key === 'ArrowUp' && candidates.value.length > 0) {
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value - 1 + candidates.value.length) % candidates.value.length;
      return;
    }
    if (event.key === 'Enter' && candidates.value.length > 0 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      confirmAt(selectedIndex.value);
      return;
    }
    if (event.key === 'Escape') {
      // The menu is the topmost transient surface: Escape closes it and
      // nothing else — the panel's own Escape must not see this one.
      event.preventDefault();
      event.stopPropagation();
      dismissMenu();
      return;
    }
    if (event.key === 'Tab') {
      dismissMenu();
      return;
    }
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (canPost.value) emit('post');
  }
}

onMounted(() => {
  // The composer opened because the person asked to comment: the field
  // takes focus so the next keystroke is the comment (the panel's own
  // focus trap would otherwise land on its close control).
  nextTick(() => element()?.focus());
});
</script>

<template>
  <section :aria-labelledby="headingId" data-testid="comment-composer" class="rounded-lg bg-default p-4">
    <h3 :id="headingId" class="text-label-large text-highlighted">New comment</h3>
    <p class="text-body-small text-muted">{{ target.quote ? 'On the selected text:' : 'On this block:' }}</p>
    <blockquote data-testid="comment-composer-excerpt" class="mt-2 border-s-2 border-default ps-3 text-body-small text-muted">“{{ target.excerpt }}”</blockquote>

    <!-- `relative`: the mention menu is placed under the field, inside
         the panel's own scroll, rather than at a viewport coordinate. -->
    <div class="relative mt-4">
      <UFormField label="Comment" help="Type @ to mention someone. Ctrl+Enter posts.">
        <UTextarea
          ref="textarea"
          v-model="body"
          data-testid="comment-composer-body"
          :rows="3"
          autoresize
          class="w-full"
          aria-haspopup="listbox"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          :aria-controls="menuOpen ? menuId : undefined"
          :aria-activedescendant="activeOptionId"
          :aria-disabled="posting || undefined"
          @keydown="onKeydown"
          @input="refreshQuery"
          @click="refreshQuery"
          @keyup="refreshQuery"
          @blur="dismissMenu"
        />
      </UFormField>
      <MentionMenu
        v-if="activeQuery"
        :id="menuId"
        class="top-full mt-1"
        :candidates="candidates"
        :selected-index="selectedIndex"
        :query="activeQuery.query"
        :option-id-prefix="optionIdPrefix"
        @select="confirmAt"
      />
    </div>

    <InlineNotice v-if="mismatch" tier="chip" tone="error" role="alert" class="mt-2">
      {{ mismatch }}
    </InlineNotice>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <UButton data-testid="comment-post" size="sm" icon="i-lucide-send" :aria-disabled="!canPost || undefined" :title="postReason" @click="canPost && emit('post')">
        Post
      </UButton>
      <UButton
        data-testid="comment-cancel"
        size="sm"
        variant="outline"
        color="neutral"
        :aria-disabled="posting || undefined"
        :title="posting ? 'Posting your comment…' : undefined"
        @click="!posting && emit('cancel')"
      >
        Cancel
      </UButton>
    </div>
  </section>
</template>
