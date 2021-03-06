import Tippy from 'tippy.js';
import GraphQLFetch from 'graphql-fetch';
import BaseBook from './books/base';
import Quran from './books/quran';
import Bible from './books/bible';
import tooltipHTML from './templates/tooltip';
import DOMIterator from './lib/dom-iterator';
import I18n from './i18n';
import _get from 'lodash.get';

const fetch = GraphQLFetch('https://alkotob.org/query');

/**
 * The main entry point for the reftagger of Alkotob
 */
class Reftagger {
  constructor(ctx) {
    this._initialized = false;
    this._tippy       = null;
    this._ctx         = ctx;
    this._i18n        = new I18n();
    this.bible        = new Bible;
    this.quran        = new Quran;

    // Initialize the default settings for the class
    this._settings = {
      language: 'en',
      onPageLoad: true,
      iframes: true, // From match.js
      exclude: [], // From match.js
      theme: 'alkotob', // dark, light, transparent, <custom>

      // specify the version hierarchy
      versions: [
        'quran', 'injil', 'tma', 'zabur', 'sabeel', 'sbleng', 'gnt'
      ]
    };
  }

  /**
   * Utility function for accessing the settings
   */
  get settings() {
    return this._settings;
  }

  /**
   * An instance of DOMIterator
   * @type {DOMIterator}
   * @access protected
   */
  iterator(ctx) {
    return new DOMIterator(
      ctx || this._ctx || document,
      this.settings.iframes,
      this.settings.exclude
    );
  }

  /**
   * Initializes the functionality on the page, called within the library
   * for initial page load and looks for the settings variable on the page.
   */
  init() {
    const self = this;
    if (this._initialized) return;

    // Start working on the options
    let options = typeof window.refTagger !== 'undefined' ? window.refTagger : {};

    // Update the settings with user defined values
    Object.keys(options).forEach(key => {
      if (typeof self._settings[key] !== 'undefined') {
        self._settings[key] = options[key];
      }
    });

    // Override the root object
    window.refTagger = self;

    self._initDOMDependencies();

    // Tag references on page load
    if (self.settings.onPageLoad) {
      window.onload = () => self.tag();
    }

    // Update translation settings
    this._i18n.lang(this._settings.language);

    self._initialized = true;
  }

  /**
   * This is the primary init function that runs regex on the HTML to find
   * references. If a context is provided it will execute only within the
   * context, otherwise it will execute on the document body. If no context
   * is provided it will attempt to destroy previous matches so it doesn't
   * double insert.
   *
   * @param ctx Actual DOM context to perform updates
   */
  tag(ctx) {
    const self = this;
    let nodes = this._getTextNodes(ctx);

    nodes.forEach(node => {
      let references = [];

      // Parse out all the references
      references.push(...self.quran.parse(node.textContent));
      references.push(...self.bible.parse(node.textContent));

      references
        .sort((a, b) => b.order - a.order) // Sort in reverse order
        .forEach(ref => this._wrapReference(node, ref));
    });

    this._initTooltips();
  }

  /**
   * Destroys all the references that have been made on the page.
   */
  destroy() {
    const references = document.querySelectorAll('.alkotob-ayah');

    // Replace them with the original text
    for (let i = 0; i < references.length; i++) {
      references[i].outerHTML = references[i].innerHTML;
    }
  }

  /**
   * Adds necessary elements to DOM
   */
  _initDOMDependencies() {
    let style = document.createElement('link');
    style.setAttribute('rel', 'stylesheet');
    style.setAttribute('type', 'text/css');
    style.setAttribute('href', 'https://cdn.alkotob.org/lib/reftagger.min.css');
    // style.setAttribute('href', '/dist/reftagger.min.css');
    document.getElementsByTagName('head')[0].appendChild(style);

    // Append tooltip html
    document.body.innerHTML += tooltipHTML;
  }

  /**
   * Retrieves the text nodes that will contain references
   */
  _getTextNodes(ctx) {
    let nodes = [];

    this.iterator(ctx).forEachNode(NodeFilter.SHOW_TEXT, node => {
      nodes.push(node);
    }, node => {
      if (this._matchesExclude(node.parentNode)) {
        return NodeFilter.FILTER_REJECT;
      } else {
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    return nodes;
  }

  /**
   * Wraps the instance element and class around matches that fit the start
   * and end positions within the node
   * @param  {HTMLElement} node - The DOM text node
   * @return {Reference} Reference to replace it with
   */
  _wrapReference(node, ref) {
    const startIdx = node.textContent.indexOf(ref.text);
    if (startIdx === -1) return;

    const version = ref.type === 'quran' ?
      this.quran.getVersion(ref.chapter, this.settings.versions) :
      this.bible.getVersion(ref.book, this.settings.versions);

    const startNode = node.splitText(startIdx);
    const permalink = ref.permalink(version);

    let refEl = document.createElement('a');
    refEl.setAttribute('href', permalink);
    refEl.setAttribute('target', '_blank');
    refEl.setAttribute('class', 'alkotob-ayah');
    refEl.setAttribute('data-text', ref.text);
    refEl.setAttribute('data-type', ref.type);
    refEl.setAttribute('data-book', ref.book);
    refEl.setAttribute('data-chapter', ref.chapter);
    refEl.setAttribute('data-verses', ref.verses);
    refEl.setAttribute('data-permalink', permalink);
    refEl.textContent = ref.text;

    // Get rid of actual text in following node
    startNode.textContent = startNode.textContent.replace(ref.text, '');

    // Insert it before the tailing statement
    startNode.parentNode.insertBefore(refEl, startNode);
  }

  /**
   * Checks if an element matches any of the specified exclude selectors. Also
   * it checks for elements in which no marks should be performed (e.g.
   * script and style tags) and optionally already marked elements
   * @param  {HTMLElement} el - The element to check
   * @return {boolean}
   * @access protected
   */
  _matchesExclude(el) {
    return DOMIterator.matches(el, this.settings.exclude.concat([
      // ignores the elements itself, not their childrens (selector *)
      "script", "style", "title", "head", "html"
    ]));
  }

  /**
   * Inits tooltips across the site by looping through text elements and
   * replacing it with reference tips.
   */
  _initTooltips() {
    const self = this;

    // Setup references to update elements
    const template = document.getElementById('alkotob-tooltip');
    const reference = document.getElementById('alkotob-reference');
    const verseText = document.getElementById('alkotob-verse-text');

    self._tippy = Tippy('.alkotob-ayah', {
      position: 'auto',
      arrow: true,
      html: '#alkotob-tooltip',
      interactive: true,
      theme: self.settings.theme,
      flipDuration: 0, // prevent a transition once tooltip size changes and updates position
      onShow() {
        if (self._tippy.loading) return;
        self._tippy.loading = true;

        const el        = self._tippy.getReferenceElement(this);
        const matchText = el.getAttribute('data-text');
        const bookType  = el.getAttribute('data-type');
        const book      = el.getAttribute('data-book');
        const chapter   = el.getAttribute('data-chapter');
        const verses    = el.getAttribute('data-verses');
        const permalink = el.getAttribute('data-permalink');

        // Update the social media buttons
        const fb = document.getElementById('alkotob-social-fb');
        fb.setAttribute('href', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(permalink)}`);

        const tw = document.getElementById('alkotob-social-tw');
        tw.setAttribute('href', `https://twitter.com/intent/tweet?url=${encodeURIComponent(permalink)}`);

        const read = document.getElementById('alkotob-readmore-link');
        read.setAttribute('href', permalink);

        // Update the reference in the tooltip
        reference.innerHTML = matchText.trim();

        self._tippy.update(this);

        const query = BaseBook.queryBuilder(bookType, verses);
        const version = bookType === 'quran' ?
          self.quran.getVersion(chapter, self.settings.versions) :
          self.bible.getVersion(book, self.settings.versions);

        const queryVars = {
          version,
          chapter: parseInt(chapter)
        };

        if (bookType !== 'quran') queryVars.book = book;

        fetch(query, queryVars).then(res => {
          if (res.errors) {
            console.log(res.errors);
            return;
          }

          let html = bookType === 'quran' ?
            Quran.render(_get(res, 'data.quran.chapter')) :
            Bible.render(_get(res, 'data.bible.book.chapter'));

          if (!html) html = `<span>${self._i18n.get('notFound')}</span>`;

          // Update UI text
          verseText.innerHTML = html;

          self._tippy.loading = false;
          self._tippy.update(this);
        });
      },

      onHide() {
        self._tippy.loading = false;
      },

      onHidden() {
        // Set loading spinner
        verseText.innerHTML = `<div class="sk-folding-cube">
          <div class="sk-cube1 sk-cube"></div>
          <div class="sk-cube2 sk-cube"></div>
          <div class="sk-cube4 sk-cube"></div>
          <div class="sk-cube3 sk-cube"></div>
        </div>`;
      }
    });
  }
}

// Initialize on script load
const tagger = new Reftagger();
tagger.init();

export default Reftagger;
