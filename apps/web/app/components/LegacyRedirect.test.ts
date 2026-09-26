import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import LegacyRedirect from './LegacyRedirect.vue';

/**
 * The screen an old address shows for the instant before the middleware
 * moves the person on: a real notice on the document frame, never a blank.
 */
describe('LegacyRedirect', () => {
  test('renders the notice as the screen’s one heading, inside the document frame', async () => {
    const wrapper = await mountSuspended(
      defineComponent({
        name: 'LegacyRedirectInApp',
        setup: () => () => h(UApp, null, { default: () => h(LegacyRedirect) }),
      }),
    );

    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.get('h1').text()).toBe("Taking you to this address's new home");
    expect(wrapper.find('main').exists()).toBe(true);
    // No footer anywhere, in either frame: the owner asked three times and
    // it went on 2026-09-23 (the reasoning is in `AppShell.vue`).
    expect(wrapper.find('footer').exists()).toBe(false);
    expect(wrapper.text()).toContain('now live under their workspace');
  });
});
