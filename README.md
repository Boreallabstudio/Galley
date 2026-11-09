# Galley

A skin for [Video.js 10](https://videojs.org) where the transcript is the player.

Galley sets a video as a page of text. Words ink in as they are spoken, a pencil rule runs under the line you are hearing, and choosing any word plays from there. The seek bar is a sentence: hover it and the card above shows the words spoken at that moment. Chapters become numbered section heads, and notes sit in the margin beside the words they belong to.

## Use it

Galley reads the media's own `<track>` elements, so captions, chapters and notes stay ordinary WebVTT:

```html
<video-player>
  <media-container class="media-skin gl" data-theme="galley">
    <!-- skin template from src/video/skin.html, with your media in place of the placeholder -->
    <video src="talk.mp4" playsinline>
      <track kind="captions" srclang="en" label="English" src="talk.vtt" default>
      <track kind="chapters" srclang="en" label="English" src="chapters.vtt">
      <track kind="metadata" label="galley" src="notes.vtt">
    </video>
  </media-container>
</video-player>
```

- Word timing comes from WebVTT inline timestamps (`<00:01:02.500>word`). Without them, words are spread across each cue by length.
- A cue whose identifier starts with `¶` begins a new paragraph. Without those marks, a pause longer than 1.6 seconds starts one.
- It works with any media element Video.js plays, including `<mux-video>`.

Galley answers to the same custom properties as the packaged Video.js skins (`--media-accent-color`, `--media-font-family`, `--media-border-radius`, `--media-object-fit`) and adds `--gl-plate-ratio` for the picture's shape. It follows `color-scheme`, `prefers-reduced-motion`, `prefers-contrast` and forced colors.

## Keys

Space or K play and pause, J and L move ten seconds, arrows move five, `[` and `]` step a line of text, 0 to 9 jump through the speech, M mutes, C toggles captions over the picture, F goes fullscreen. Tab moves into the text, where arrow keys move between lines and Enter plays from one.

## Develop

```sh
npm install
npm run dev:site    # the showcase page
npm run dev         # the Video.js skin workbench
npm run build:site  # static build in dist-site/
```

The skin lives in `src/video/`: `skin.html` and `skin.css` for the player, `text.ts` for the transcript, caption line, chapter title and seek card, `edition.ts` for the shared clock and track reading, and `vtt.ts` for the WebVTT reader. The showcase page is in `site/`.

## Credits

The demonstration plays President John F. Kennedy's address at Rice University, Houston, 12 September 1962, from the [Internet Archive](https://archive.org/details/president-john-f.-kennedy-09-12-1962), where it is marked as public domain. Set in [Newsreader](https://github.com/productiontype/Newsreader). Streamed by Mux.

Made by Boreal Lab Studio, Ontario, Canada. Licensed under the [Apache License 2.0](LICENSE).
