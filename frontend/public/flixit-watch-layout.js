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
    return "https://image.tmdb.org/t/p/" + (size || "w780") + value;
  }

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function makePill(label) {
    return el("span", "flixit-watch-pill", label);
  }

  function mountShell(route, page, player) {
    var old = page.querySelector(".flixit-watch-details");
    if (old) old.remove();

    var details = el("section", "flixit-watch-details");
    details.setAttribute("aria-label", "Dettagli riproduzione");

    var ambient = el("div", "flixit-watch-details__ambient");
    var poster = player.querySelector("video") && player.querySelector("video").getAttribute("poster");
    if (poster) ambient.style.backgroundImage = "url(\"" + poster.replace(/\"/g, "%22") + "\")";
    details.appendChild(ambient);

    var top = el("div", "flixit-watch-details__top");
    var copy = el("div", "flixit-watch-details__copy");
    var eyebrow = el("div", "flixit-watch-details__eyebrow", route.type === "tv" ? "STAI GUARDANDO" : "ORA IN RIPRODUZIONE");
    var title = el("h1", "flixit-watch-details__title", text('[data-testid="player-title"]') || (route.type === "tv" ? "Serie TV" : "Film"));
    var subtitleText = text('[data-testid="player-episode"]');
    var subtitle = el("p", "flixit-watch-details__subtitle", subtitleText || (route.type === "tv" ? ("Stagione " + route.season + " · Episodio " + route.episode) : "Film"));
    var pills = el("div", "flixit-watch-details__pills");
    pills.appendChild(makePill(route.type === "tv" ? "Serie TV" : "Film"));
    if (route.type === "tv") {
      pills.appendChild(makePill("S" + route.season));
      pills.appendChild(makePill("E" + route.episode));
    }

    copy.appendChild(eyebrow);
    copy.appendChild(title);
    copy.appendChild(subtitle);
    copy.appendChild(pills);
    top.appendChild(copy);

    if (route.type === "tv") {
      var next = el("button", "flixit-watch-next", "Prossimo episodio");
      next.type = "button";
      next.addEventListener("click", function () {
        var realNext = page.querySelector('[data-testid="next-episode-button"]');
        if (realNext) realNext.click();
        else {
          var url = new URL(window.location.href);
          url.searchParams.set("s", String(route.season));
          url.searchParams.set("e", String(route.episode + 1));
          window.location.href = url.toString();
        }
      });
      top.appendChild(next);
    }

    details.appendChild(top);

    if (route.type === "tv") {
      var episodeSection = el("div", "flixit-watch-episodes");
      var episodeHead = el("div", "flixit-watch-episodes__head");
      episodeHead.appendChild(el("h2", "flixit-watch-episodes__title", "Episodi"));
      episodeHead.appendChild(el("span", "flixit-watch-episodes__season", "Stagione " + route.season));
      episodeSection.appendChild(episodeHead);
      var rail = el("div", "flixit-watch-episodes__rail");
      rail.appendChild(el("div", "flixit-watch-episode-skeleton", "Caricamento episodi…"));
      episodeSection.appendChild(rail);
      details.appendChild(episodeSection);

      fetch("/api/public/tv/" + route.id + "/season/" + route.season, { headers: { Accept: "application/json" } })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          var episodes = data && Array.isArray(data.episodes) ? data.episodes : [];
          rail.innerHTML = "";
          if (!episodes.length) {
            rail.appendChild(el("div", "flixit-watch-episode-skeleton", "Episodi non disponibili"));
            return;
          }

          var start = Math.max(0, episodes.findIndex(function (item) { return Number(item.episode_number) === route.episode; }) - 1);
          episodes.slice(start, start + 6).forEach(function (item) {
            var number = Number(item.episode_number || 0);
            var card = el("button", "flixit-watch-episode" + (number === route.episode ? " is-current" : ""));
            card.type = "button";
            var imageWrap = el("span", "flixit-watch-episode__image");
            var still = imgUrl(item.still_path, "w780");
            if (still) {
              var image = document.createElement("img");
              image.src = still;
              image.alt = "";
              image.loading = "lazy";
              image.decoding = "async";
              imageWrap.appendChild(image);
            }
            imageWrap.appendChild(el("span", "flixit-watch-episode__number", String(number || "")));
            var cardCopy = el("span", "flixit-watch-episode__copy");
            cardCopy.appendChild(el("strong", "flixit-watch-episode__name", item.name || ("Episodio " + number)));
            cardCopy.appendChild(el("small", "flixit-watch-episode__meta", number === route.episode ? "In riproduzione" : (item.runtime ? item.runtime + " min" : "Riproduci")));
            card.appendChild(imageWrap);
            card.appendChild(cardCopy);
            card.addEventListener("click", function () {
              if (number === route.episode) return;
              var url = new URL(window.location.href);
              url.searchParams.set("s", String(route.season));
              url.searchParams.set("e", String(number));
              url.searchParams.delete("t");
              window.location.href = url.toString();
            });
            rail.appendChild(card);
          });
        })
        .catch(function () {
          rail.innerHTML = "";
          rail.appendChild(el("div", "flixit-watch-episode-skeleton", "Episodi non disponibili"));
        });
    }

    player.insertAdjacentElement("afterend", details);
    requestAnimationFrame(function () { details.classList.add("is-ready"); });
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
