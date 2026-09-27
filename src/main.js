// Bootstrap: the mountain (default) or the Phase 2 gray-box test course (?course=graybox).
const params = new URLSearchParams(location.search);
if (params.get('course') === 'graybox') import('./graybox-main.js');
else import('./game.js');
