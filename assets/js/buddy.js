/* Secret Gift character renderer: five geometric buddies, six moods, five arm poses. */
(function (global) {
  'use strict';

  var CHARS = {
    momo:  { fx: 100, fy: 110, fs: 1,    aL: [26, 128], aR: [174, 128], legY: 186 },
    boxi:  { fx: 80,  fy: 118, fs: 1,    aL: [26, 132], aR: [174, 132], legY: 186 },
    pine:  { fx: 100, fy: 132, fs: 0.92, aL: [42, 146], aR: [158, 146], legY: 186 },
    bloom: { fx: 100, fy: 114, fs: 1,    aL: [22, 128], aR: [178, 128], legY: 190 },
    zing:  { fx: 100, fy: 116, fs: 0.84, aL: [56, 128], aR: [144, 128], legY: 150 }
  };

  var INK = '#171717';
  var LINE = 'fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';

  var BODIES = {
    momo:
      '<circle cx="100" cy="12" r="7" fill="none" stroke="' + INK + '" stroke-width="4"/>' +
      '<rect x="84" y="18" width="32" height="18" rx="5" fill="#FFB900"/>' +
      '<circle cx="100" cy="114" r="82" fill="#FA63A7"/>',
    boxi:
      '<rect x="20" y="42" width="160" height="150" rx="26" fill="#FF6A00"/>' +
      '<rect x="126" y="42" width="26" height="150" fill="#009C63"/>' +
      '<ellipse cx="121" cy="29" rx="21" ry="12" transform="rotate(25 121 29)" fill="#009C63"/>' +
      '<ellipse cx="157" cy="29" rx="21" ry="12" transform="rotate(-25 157 29)" fill="#009C63"/>' +
      '<circle cx="139" cy="40" r="10" fill="#009C63"/>',
    pine:
      '<path d="M100 22 L178 184 L22 184 Z" fill="#009C63" stroke="#009C63" stroke-width="22" stroke-linejoin="round"/>' +
      '<circle cx="100" cy="9" r="9" fill="#FFB900"/>',
    bloom:
      '<g fill="#A56AC8"><circle cx="156" cy="112" r="30"/><circle cx="139.6" cy="151.6" r="30"/>' +
      '<circle cx="100" cy="168" r="30"/><circle cx="60.4" cy="151.6" r="30"/><circle cx="44" cy="112" r="30"/>' +
      '<circle cx="60.4" cy="72.4" r="30"/><circle cx="100" cy="56" r="30"/><circle cx="139.6" cy="72.4" r="30"/>' +
      '<circle cx="100" cy="112" r="62"/></g>' +
      '<ellipse cx="87" cy="22" rx="14" ry="7" transform="rotate(25 87 22)" fill="#009C63"/>' +
      '<ellipse cx="113" cy="22" rx="14" ry="7" transform="rotate(-25 113 22)" fill="#009C63"/>' +
      '<circle cx="100" cy="28" r="7" fill="#FA63A7"/>',
    zing:
      '<path d="M100 24 L127 74.8 L183.7 84.8 L143.8 126.2 L151.7 183.2 L100 158 L48.3 183.2 L56.2 126.2 L16.3 84.8 L73 74.8 Z" ' +
      'fill="#FFB900" stroke="#FFB900" stroke-width="20" stroke-linejoin="round"/>'
  };

  var POSES = {
    down: [[-12, 18, -16, 44], [12, 18, 16, 44]],
    up:   [[-22, -4, -30, -46], [22, -4, 30, -46]],
    wave: [[-12, 18, -16, 44], [24, -8, 28, -50]]
  };

  function r1(n) { return Math.round(n * 10) / 10; }
  function clamp(v) { v = Number(v) || 0; return Math.max(-1, Math.min(1, v)); }

  function face(mood, lx, ly) {
    var pL = [r1(-24 + lx * 6), r1(-8 + ly * 6)];
    var pR = [r1(24 + lx * 6), r1(-8 + ly * 6)];
    var wL = [r1(-25 + lx * 7), r1(-10 + ly * 7)];
    var wR = [r1(25 + lx * 7), r1(-10 + ly * 7)];
    switch (mood) {
      case 'happy':
        return '<path d="M-36 -4 Q-24 -20 -12 -4" ' + LINE + '/><path d="M12 -4 Q24 -20 36 -4" ' + LINE + '/>' +
          '<path d="M-16 12 Q0 36 16 12 Z" fill="' + INK + '" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>';
      case 'wow':
        return '<circle cx="-25" cy="-10" r="17" fill="#FFFFFF"/><circle cx="25" cy="-10" r="17" fill="#FFFFFF"/>' +
          '<circle cx="' + wL[0] + '" cy="' + wL[1] + '" r="6" fill="' + INK + '"/>' +
          '<circle cx="' + wR[0] + '" cy="' + wR[1] + '" r="6" fill="' + INK + '"/>' +
          '<ellipse cx="0" cy="25" rx="8" ry="10" fill="' + INK + '"/>';
      case 'wink':
        return '<path d="M-36 -6 Q-24 -20 -12 -6" ' + LINE + '/>' +
          '<circle cx="24" cy="-8" r="15" fill="#FFFFFF"/>' +
          '<circle cx="' + pR[0] + '" cy="' + pR[1] + '" r="7.5" fill="' + INK + '"/>' +
          '<path d="M-14 16 Q2 32 16 13" ' + LINE + '/>';
      case 'sly':
        return '<path d="M-40 -8 A16 16 0 0 0 -8 -8 Z" fill="#FFFFFF"/><path d="M8 -8 A16 16 0 0 0 40 -8 Z" fill="#FFFFFF"/>' +
          '<circle cx="-15" cy="-3" r="6.5" fill="' + INK + '"/><circle cx="33" cy="-3" r="6.5" fill="' + INK + '"/>' +
          '<path d="M-42 -8 L-6 -8" ' + LINE + '/><path d="M6 -8 L42 -8" ' + LINE + '/>' +
          '<path d="M-8 21 Q4 25 14 15" ' + LINE + '/>';
      case 'calm':
        return '<path d="M-36 -10 Q-24 3 -12 -10" ' + LINE + '/><path d="M12 -10 Q24 3 36 -10" ' + LINE + '/>' +
          '<path d="M-37 -11 L-43 -16" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M37 -11 L43 -16" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M-10 16 Q0 25 10 16" ' + LINE + '/>';
      default: // open
        return '<circle cx="-24" cy="-8" r="15" fill="#FFFFFF"/><circle cx="24" cy="-8" r="15" fill="#FFFFFF"/>' +
          '<circle cx="' + pL[0] + '" cy="' + pL[1] + '" r="7.5" fill="' + INK + '"/>' +
          '<circle cx="' + pR[0] + '" cy="' + pR[1] + '" r="7.5" fill="' + INK + '"/>' +
          '<path d="M-12 20 Q0 30 12 20" ' + LINE + '/>';
    }
  }

  /**
   * svg({ who, mood, arms, legs, lookX, lookY }) -> SVG markup string.
   * The SVG has no fixed size; it fills its container's width (viewBox 260 × 250).
   */
  function svg(o) {
    o = o || {};
    var who = CHARS[o.who] ? o.who : 'momo';
    var c = CHARS[who];
    var mood = o.mood || 'happy';
    var arms = o.arms || 'none';
    var lx = clamp(o.lookX), ly = clamp(o.lookY);
    var out = '<svg viewBox="-30 -10 260 250" aria-hidden="true" focusable="false">';
    if (o.legs !== false && o.legs !== 'off') {
      out += '<g ' + LINE + '><path d="M 86 ' + c.legY + ' L 86 230 L 74 230"/>' +
        '<path d="M 114 ' + c.legY + ' L 114 230 L 126 230"/></g>';
    }
    out += BODIES[who];
    var armL = '', armR = '', hL = null, hR = null;
    if (arms === 'hold') {
      armL = 'M ' + c.aL[0] + ' ' + c.aL[1] + ' Q ' + c.aL[0] + ' 172 50 172';
      armR = 'M ' + c.aR[0] + ' ' + c.aR[1] + ' Q ' + c.aR[0] + ' 172 150 172';
      hL = [50, 172]; hR = [150, 172];
    } else if (POSES[arms]) {
      var p = POSES[arms];
      armL = 'M ' + c.aL[0] + ' ' + c.aL[1] + ' q ' + p[0].join(' ');
      armR = 'M ' + c.aR[0] + ' ' + c.aR[1] + ' q ' + p[1].join(' ');
      hL = [c.aL[0] + p[0][2], c.aL[1] + p[0][3]];
      hR = [c.aR[0] + p[1][2], c.aR[1] + p[1][3]];
    }
    if (armL) {
      out += '<path d="' + armL + '" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="' + armR + '" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>' +
        '<circle cx="' + hL[0] + '" cy="' + hL[1] + '" r="6.5" fill="' + INK + '"/>' +
        '<circle cx="' + hR[0] + '" cy="' + hR[1] + '" r="6.5" fill="' + INK + '"/>';
    }
    out += '<g transform="translate(' + c.fx + ' ' + c.fy + ') scale(' + c.fs + ')">' + face(mood, lx, ly) + '</g>';
    return out + '</svg>';
  }

  /** Where the face sits inside the element, as a 0–1 fraction of its width / height. */
  function faceAnchor(who) {
    var c = CHARS[who] || CHARS.momo;
    return { x: (c.fx + 30) / 260, y: (c.fy + 10) / 250 };
  }

  global.Buddy = { svg: svg, faceAnchor: faceAnchor };
})(window);
