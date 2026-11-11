// Home: one tile per module. Back from here exits the app.
(function () {
  'use strict';

  const GTV = window.GTV;
  let lastFocus = 0;

  GTV.register({
    id: 'home',
    title: 'Home',
    inHome: false,
    mount: function (el, ctx) {
      const items = GTV.modules().filter((m) => m.inHome !== false);

      el.innerHTML =
        '<div class="home">' +
        '<h1 class="home-title">Glordu TV</h1>' +
        '<div class="home-tiles"></div>' +
        '<p class="hint">◀ ▶ choose · OK open · Back exit</p>' +
        '</div>';
      const tilesEl = el.querySelector('.home-tiles');
      const tiles = items.map((module) => {
        const tile = document.createElement('div');
        tile.className = 'tile';
        const title = document.createElement('div');
        title.className = 'tile-title';
        title.textContent = module.title;
        const desc = document.createElement('div');
        desc.className = 'tile-desc';
        desc.textContent = module.description || '';
        tile.appendChild(title);
        tile.appendChild(desc);
        tilesEl.appendChild(tile);
        return tile;
      });

      let focus = Math.min(lastFocus, tiles.length - 1);
      function render() {
        tiles.forEach((tile, i) => tile.classList.toggle('is-focused', i === focus));
        lastFocus = focus;
      }
      render();

      return {
        onKey: function (key) {
          if (key === 'LEFT' && focus > 0) {
            focus--;
            render();
            return true;
          }
          if (key === 'RIGHT' && focus < tiles.length - 1) {
            focus++;
            render();
            return true;
          }
          if (key === 'ENTER' && items[focus]) {
            ctx.open(items[focus].id);
            return true;
          }
          return false;
        },
      };
    },
  });
})();
