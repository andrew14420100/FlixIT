(function () {
  "use strict";

  var mountedFor = "";
  var observer = null;

  function text(selector) {
    var node = document.querySelector(selector);
    return node ? String(node.textContent || "").trim() : "";
  }

  function parseWatchRoute() {
    var match = (window.location.pathname || "").match(/\/watch\/(movie|tv)\/(\d+)/i);
    if (!match) return null;
    var params = new URLSearchParams(window.location.search || "");
    return {
      type: match[1].toLowerCase(),
      id: match[2],
      season: Math.max(1, Number(params.get("s") || 1)),
      episode: Math.max(1, Number(params.get("e") || 1))
    };
  }

  function imgUrl(path, size) {
    var value = String(path || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return "https://image.tmdb.org/t/p/" + (size || "original") + value;
  }

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function appendMeta(container, value) {
    if (!value) return;
    if (container.childNodes.length) container.appendChild(el("span", "flixit-watch-meta__dot", "·"));
    container.appendChild(el("span", "flixit-watch-meta__item", value));
  }

  function mountShell(route, page, player) {
    var old = page.querySelector(".flixit-watch-details");
    if (old) old.remove();

    var details = el("section", "flixit-watch-details");
    details.setAttribute("aria-label", "Dettagli riproduzione");

    var backdrop = player.querySelector("video") && player.querySelector("video").getAttribute("poster");
    var ambient = el("div", "flixit-watch-details__ambient");
    if (backdrop) ambient.style.backgroundImage = "url(\"" + backdrop.replace(/\"/g, "%22") + "\")";
    details.appendChild(ambient);

    var inner = el("div", "flixit-watch-details__inner");
    details.appendChild(inner);

    var posterWrap = el("div", "flixit-watch-poster");
    var poster = document.createElement("img");
    poster.alt = "";
    poster.decoding = "async";
    poster.loading = "lazy";
    posterWrap.appendChild(poster);
    inner.appendChild(posterWrap);

    var main = el("div", "flixit-watch-main");
    var title = el("h1", "flixit-watch-details__title", text('[data-testid="player-title"]') || (route.type === "tv" ? "Serie TV" : "Film"));
    main.appendChild(title);
    main.appendChild(el("div", "flixit-watch-title-line"));

    var meta = el("div", "flixit-watch-meta");
    main.appendChild(meta);

    var description = el("p", "flixit-watch-description", "");
    main.appendChild(description);

    var actions = el("div", "flixit-watch-actions");
    var resume = el("button", "flixit-watch-action flixit-watch-action--primary", "Riprendi");
    resume.type = "button";
    resume.addEventListener("click", function () {
      var play = page.querySelector('[data-testid="play-pause-button"]');
      if (play) play.click();
    });
    actions.appendChild(resume);

    if (route.type === "tv") {
      var episodesAction = el("button", "flixit-watch-action flixit-watch-action--secondary", "Episodi");
      episodesAction.type = "button";
      episodesAction.addEventListener("click", function () {
        var panel = details.querySelector(".flixit-watch-episodes-panel");
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      actions.appendChild(episodesAction);
    }
    main.appendChild(actions);
    inner.appendChild(main);

    var panel = null;
    var list = null;
    if (route.type === "tv") {
      panel = el("aside", "flixit-watch-episodes-panel");
      var panelHead = el("div", "flixit-watch-episodes-panel__head");
      panelHead.appendChild(el("span", "flixit-watch-episodes-panel__season", "Stagione " + route.season));
      panelHead.appendChild(el("span", "flixit-watch-episodes-panel__chevron", "›"));
      panel.appendChild(panelHead);
      list = el("div", "flixit-watch-episodes-panel__list");
      panel.appendChild(list);
      inner.appendChild(panel);
    }

    player.insertAdjacentElement("afterend", details);

    var assetPromise = fetch("/api/public/media-assets/" + route.type + "/" + route.id, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    var seasonPromise = route.type === "tv"
      ? fetch("/api/public/tv/" + route.id + "/season/" + route.season, { headers: { Accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);

    Promise.all([assetPromise, seasonPromise]).then(function (values) {
      var asset = values[0] || {};
      var seasonData = values[1] || {};
      var episodes = Array.isArray(seasonData.episodes) ? seasonData.episodes : [];
      var currentEpisode = episodes.find(function (item) { return Number(item.episode_number) === route.episode; }) || null;

      var resolvedTitle = asset.title || asset.name || title.textContent;
      title.textContent = resolvedTitle || title.textContent;

      var posterSrc = imgUrl(asset.poster_path || asset.poster_url, "w500");
      if (!posterSrc && backdrop) posterSrc = backdrop;
      if (posterSrc) poster.src = posterSrc;
      else posterWrap.style.display = "none";

      var year = String(asset.release_date || asset.first_air_date || asset.year || "").slice(0, 4);
      var seasonsCount = asset.number_of_seasons || asset.seasons || (route.type === "tv" ? route.season : "");
      var genres = Array.isArray(asset.genres)
        ? asset.genres.map(function (g) { return typeof g === "string" ? g : g && g.name; }).filter(Boolean).slice(0, 2).join(", ")
        : (asset.genre || asset.genres || "");
      var certification = asset.certification || asset.rating || "";

      appendMeta(meta, year);
      if (route.type === "tv" && seasonsCount) appendMeta(meta, String(seasonsCount) + (Number(seasonsCount) === 1 ? " Stagione" : " Stagioni"));
      if (genres) appendMeta(meta, genres);
      if (asset.quality) appendMeta(meta, String(asset.quality));
      if (certification) appendMeta(meta, String(certification));

      description.textContent = asset.overview || asset.description || (currentEpisode && currentEpisode.overview) || (currentEpisode && currentEpisode.name ? ("Stagione " + route.season + ", episodio " + route.episode + ": " + currentEpisode.name + ".") : "");
      if (!description.textContent) description.style.display = "none";

      if (panel && list) {
        list.innerHTML = "";
        var start = Math.max(0, episodes.findIndex(function (item) { return Number(item.episode_number) === route.episode; }));
        var subset = episodes.slice(start, start + 3);
        if (!subset.length) subset = episodes.slice(0, 3);

        subset.forEach(function (item) {
          var number = Number(item.episode_number || 0);
          var row = el("button", "flixit-watch-episode-row" + (number === route.episode ? " is-current" : ""));
          row.type = "button";
          row.appendChild(el("span", "flixit-watch-episode-row__number", String(number)));

          var thumb = el("span", "flixit-watch-episode-row__thumb");
          var still = imgUrl(item.still_path, "w500");
          if (still) {
            var img = document.createElement("img");
            img.src = still;
            img.alt = "";
            img.loading = "lazy";
            img.decoding = "async";
            thumb.appendChild(img);
          }
          row.appendChild(thumb);

          var copy = el("span", "flixit-watch-episode-row__copy");
          copy.appendChild(el("strong", "flixit-watch-episode-row__name", item.name || ("Episodio " + number)));
          copy.appendChild(el("small", "flixit-watch-episode-row__runtime", item.runtime ? item.runtime + " min" : ""));
          row.appendChild(copy);
          row.appendChild(el("span", "flixit-watch-episode-row__play", "▶"));

          row.addEventListener("click", function () {
            if (number === route.episode) return;
            var url = new URL(window.location.href);
            url.searchParams.set("s", String(route.season));
            url.searchParams.set("e", String(number));
            url.searchParams.delete("t");
            window.location.href = url.toString();
          });
          list.appendChild(row);
        });
      }

      details.classList.add("is-ready");
    });
  }

  function tryMount() {
    var route = parseWatchRoute();
    if (!route) {
      mountedFor = "";
      return;
    }
    var page = document.querySelector('[data-testid="watch-page"]');
    var player = page && page.querySelector('[data-testid="custom-video-player"]');
    if (!page || !player) return;
    var key = route.type + ":" + route.id + ":" + route.season + ":" + route.episode;
    if (mountedFor === key && page.querySelector(".flixit-watch-details")) return;
    mountedFor = key;
    mountShell(route, page, player);
  }

  function start() {
    tryMount();
    observer = new MutationObserver(function () { tryMount(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", function () { mountedFor = ""; setTimeout(tryMount, 0); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
