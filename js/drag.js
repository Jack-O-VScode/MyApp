/* Drag gestures, for moving things around the calendar.

   One recogniser for mouse, pen and touch, built on pointer events rather than
   HTML drag-and-drop — which iOS does not support for anything but text and
   images. What a drag *does* is left to the caller: `start` is handed the item
   and returns a session with `move` and `end`, so the same gesture can carry a
   chip to another day or slide a block up the timeline.

   A finger has to hold still for a moment before a drag begins. Without that,
   every attempt to scroll the week would pick up whatever it started on.
*/
window.Drag = (function () {
  'use strict';

  var HOLD = 300;          // ms a finger rests before the item lifts
  var SLOP = 8;            // px a finger may wander while resting
  var MOUSE_SLOP = 4;      // px a mouse moves before a press becomes a drag

  var active = null;
  var swallow = { root: null, until: 0 };

  // Once a touch drag is under way the page must not scroll under it. This
  // has to be a non-passive listener, or the browser ignores preventDefault.
  document.addEventListener('touchmove', function (touchEvent) {
    if (active && active.started) touchEvent.preventDefault();
  }, { passive: false });

  // The click that follows a drop is not a click on what was dropped. Only
  // that one click, and only inside the area dragged in: anything else the
  // next moment is a real click.
  document.addEventListener('click', function (clickEvent) {
    if (!swallow.root || Date.now() > swallow.until) return;
    var inside = swallow.root.contains(clickEvent.target);
    swallow.root = null;
    if (!inside) return;
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
  }, true);
  // A fresh press starts a fresh gesture: whatever click comes now is its own.
  document.addEventListener('pointerdown', function () { swallow.root = null; }, true);

  function attach(root, options) {
    // A long press on a phone otherwise opens the system menu or selects text.
    root.addEventListener('contextmenu', function (menuEvent) {
      if (menuEvent.target.closest(options.selector)) menuEvent.preventDefault();
    });

    root.addEventListener('pointerdown', function (down) {
      if (active) return;
      if (down.pointerType === 'mouse' && down.button !== 0) return;
      var item = down.target.closest(options.selector);
      if (!item || !root.contains(item)) return;

      var touch = down.pointerType !== 'mouse';
      var gesture = {
        item: item,
        target: down.target,
        touch: touch,
        started: false,
        session: null,
        x: down.clientX,
        y: down.clientY
      };
      active = gesture;
      var timer = touch ? setTimeout(begin, HOLD) : null;

      function begin() {
        timer = null;
        gesture.session = options.start(item, gesture);
        if (!gesture.session) {
          finish();
          return;
        }
        gesture.started = true;
        document.body.classList.add('is-dragging');
        if (touch && navigator.vibrate) navigator.vibrate(8);
      }

      function move(moveEvent) {
        if (moveEvent.pointerId !== down.pointerId) return;
        var dx = moveEvent.clientX - gesture.x;
        var dy = moveEvent.clientY - gesture.y;
        if (!gesture.started) {
          if (touch) {
            // Moving before the hold is up is a scroll, not a drag.
            if (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP) finish();
            return;
          }
          if (Math.abs(dx) < MOUSE_SLOP && Math.abs(dy) < MOUSE_SLOP) return;
          begin();
          if (!gesture.started) return;
        }
        moveEvent.preventDefault();
        gesture.session.move(dx, dy, moveEvent.clientX, moveEvent.clientY);
      }

      function up(upEvent) {
        if (upEvent.pointerId !== down.pointerId) return;
        if (gesture.started) {
          swallow = { root: root, until: Date.now() + 400 };
          gesture.session.end(upEvent.type === 'pointerup');
        }
        finish();
      }

      function finish() {
        if (timer) clearTimeout(timer);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        document.body.classList.remove('is-dragging');
        if (active === gesture) active = null;
      }

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  // Minutes moved for a vertical distance, in whole steps.
  function snapMinutes(pixels, pixelsPerHour, step) {
    var minutes = pixels / pixelsPerHour * 60;
    return Math.round(minutes / step) * step;
  }

  return { attach: attach, snapMinutes: snapMinutes };
})();
