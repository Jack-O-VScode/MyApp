/* Markdown for notes: headings, bold, italic, links, lists, checklists, quotes,
   code and images — the handful people actually type.

   Safety comes first and is structural: every character of the note is
   HTML-escaped before any formatting is recognised, and the only markup that
   ever comes out is markup written here. A link is only made from http(s) or
   mailto, so a note cannot smuggle in a javascript: URL either.

   Images are `![name](att:<id>)` for a picture attached to the note (stored in
   your own project, fetched with your own sign-in) or a plain https address.
   The renderer leaves attached images as placeholders with `data-att`, and the
   note editor fills them in, because fetching needs to be signed in.
*/
window.Markdown = (function () {
  'use strict';

  function escape(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var SAFE_URL = /^(https?:\/\/|mailto:)/i;

  /* --------------------------------------------------------------- inline -- */

  // Runs on text that is already escaped. Code spans, images and links are
  // stashed first, so the bold/italic pass cannot reach inside them.
  function inline(escaped) {
    var stash = [];
    function keep(html) {
      stash.push(html);
      return '\u0000' + (stash.length - 1) + '\u0000';
    }

    var text = escaped.replace(/`([^`]+)`/g, function (all, code) {
      return keep('<code>' + code + '</code>');
    });

    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (all, alt, url) {
      if (/^att:/i.test(url)) {
        return keep('<span class="md-image is-loading" data-att="' + url.slice(4) +
          '" role="img" aria-label="' + alt + '"></span>');
      }
      if (/^https:\/\//i.test(url)) {
        return keep('<img class="md-image" src="' + url + '" alt="' + alt + '" loading="lazy">');
      }
      return all;
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (all, label, url) {
      if (!SAFE_URL.test(url.replace(/&amp;/g, '&'))) return all;
      return keep('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    });

    // Bare addresses become links too.
    text = text.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, function (url) {
      return keep('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
    });

    text = text
      .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([^_]*?\S)__/g, '<strong>$1</strong>')
      .replace(/~~(?=\S)([^~]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');

    return text.replace(/\u0000(\d+)\u0000/g, function (all, index) { return stash[Number(index)]; });
  }

  /* --------------------------------------------------------------- blocks -- */

  var CHECK = /^(\s*)[-*+]\s\[( |x|X)\]\s?(.*)$/;
  var BULLET = /^(\s*)[-*+]\s+(.*)$/;
  var NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;

  // Checklist items carry the line they came from, so ticking one in the
  // rendered view can tick the right line of the text.
  function render(source) {
    var lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var paragraph = [];
    var list = null;          // { tag, items }
    var fence = null;         // lines of an open ``` block

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push('<p>' + paragraph.map(function (line) { return inline(escape(line)); }).join('<br>') + '</p>');
      paragraph = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.tag + (list.checks ? ' class="md-checklist"' : '') + '>' +
        list.items.join('') + '</' + list.tag + '>');
      list = null;
    }
    function openList(tag, checks) {
      if (list && list.tag === tag && list.checks === checks) return;
      flushList();
      list = { tag: tag, checks: checks, items: [] };
    }

    lines.forEach(function (line, index) {
      if (fence) {
        if (/^\s*```/.test(line)) {
          out.push('<pre><code>' + fence.map(escape).join('\n') + '</code></pre>');
          fence = null;
        } else {
          fence.push(line);
        }
        return;
      }
      if (/^\s*```/.test(line)) {
        flushParagraph();
        flushList();
        fence = [];
        return;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }

      var heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        var level = heading[1].length + 1;   // # is h2: the note title is the h1
        out.push('<h' + level + '>' + inline(escape(heading[2])) + '</h' + level + '>');
        return;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        flushList();
        out.push('<hr>');
        return;
      }
      var quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) {
        flushParagraph();
        flushList();
        out.push('<blockquote>' + inline(escape(quote[1])) + '</blockquote>');
        return;
      }

      var check = CHECK.exec(line);
      if (check) {
        flushParagraph();
        openList('ul', true);
        var done = check[2] !== ' ';
        list.items.push('<li class="md-check' + (done ? ' is-done' : '') + '">' +
          '<input type="checkbox" data-line="' + index + '"' + (done ? ' checked' : '') +
          ' aria-label="Done">' + '<span>' + inline(escape(check[3])) + '</span></li>');
        return;
      }
      var bullet = BULLET.exec(line);
      if (bullet) {
        flushParagraph();
        openList('ul', false);
        list.items.push('<li>' + inline(escape(bullet[2])) + '</li>');
        return;
      }
      var numbered = NUMBERED.exec(line);
      if (numbered) {
        flushParagraph();
        openList('ol', false);
        list.items.push('<li>' + inline(escape(numbered[2])) + '</li>');
        return;
      }

      flushList();
      paragraph.push(line);
    });

    if (fence) out.push('<pre><code>' + fence.map(escape).join('\n') + '</code></pre>');
    flushParagraph();
    flushList();
    return out.join('\n');
  }

  // Ticks or unticks the checklist item on line `index`.
  function toggleLine(source, index) {
    var lines = String(source || '').split('\n');
    var match = CHECK.exec(lines[index] || '');
    if (!match) return source;
    lines[index] = lines[index].replace(/\[( |x|X)\]/, match[2] === ' ' ? '[x]' : '[ ]');
    return lines.join('\n');
  }

  // The words without the punctuation, for previews in lists and search hits.
  function plain(source) {
    return String(source || '')
      .replace(/```/g, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, function (all, alt) { return '🖼 ' + (alt || 'image'); })
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*#{1,3}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^(\s*)[-*+]\s\[( |x|X)\]\s?/gm, function (all, lead, mark) {
        return lead + (mark === ' ' ? '☐ ' : '☑ ');
      })
      .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
      .replace(/\*\*|__|~~|`/g, '')
      .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2');
  }

  return { render: render, plain: plain, toggleLine: toggleLine, escape: escape };
})();
