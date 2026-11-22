(function () {
  "use strict";

  var DATA_URL = "data/videos.json";
  var TZ = "America/Vancouver";
  var EMPTY_MESSAGE = "No FSD v15 videos found yet — checking every hour.";
  var widgetsLoading = false;
  var widgetsReady = false;
  var pendingLoads = [];

  var feed = document.getElementById("feed");
  var meta = document.getElementById("meta");
  var countEl = document.getElementById("count");
  var updatedEl = document.getElementById("updated");
  var statusEl = document.getElementById("status");

  function showStatus(message, isError) {
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function formatPacific(iso, withZone) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
    return withZone ? formatted + " PT" : formatted;
  }

  function newestAddedAt(posts) {
    var newest = "";
    for (var i = 0; i < posts.length; i++) {
      var value = posts[i].added_at || "";
      if (value > newest) newest = value;
    }
    return newest;
  }

  function fallbackCaption(text) {
    if (!text) return "FSD v15 video";
    var cleaned = String(text).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    if (cleaned.length > 160) cleaned = cleaned.slice(0, 157).trim() + "…";
    return cleaned || "FSD v15 video";
  }

  function ensureWidgets(callback) {
    if (widgetsReady && window.twttr && window.twttr.widgets) {
      callback();
      return;
    }
    pendingLoads.push(callback);
    if (widgetsLoading) return;
    widgetsLoading = true;
    var script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.charset = "utf-8";
    script.onload = function () {
      if (window.twttr && window.twttr.ready) {
        window.twttr.ready(function () {
          widgetsReady = true;
          var queue = pendingLoads.slice();
          pendingLoads = [];
          queue.forEach(function (fn) { fn(); });
        });
      } else {
        widgetsReady = true;
        var queue = pendingLoads.slice();
        pendingLoads = [];
        queue.forEach(function (fn) { fn(); });
      }
    };
    document.body.appendChild(script);
  }

  function hydrateEmbed(container, url) {
    if (container.getAttribute("data-loaded") === "1") return;
    container.setAttribute("data-loaded", "1");
    container.innerHTML = "";
    var block = document.createElement("blockquote");
    block.className = "twitter-tweet";
    block.setAttribute("data-theme", "dark");
    block.setAttribute("data-dnt", "true");
    block.setAttribute("data-conversation", "none");
    var link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    block.appendChild(link);
    container.appendChild(block);
    ensureWidgets(function () {
      if (window.twttr && window.twttr.widgets && window.twttr.widgets.load) {
        window.twttr.widgets.load(container);
      }
    });
  }

  function observeEmbeds() {
    var nodes = feed.querySelectorAll(".embed[data-url]");
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(nodes, function (node) {
        hydrateEmbed(node, node.getAttribute("data-url"));
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var node = entry.target;
        observer.unobserve(node);
        hydrateEmbed(node, node.getAttribute("data-url"));
      });
    }, { rootMargin: "800px 0px", threshold: 0.01 });
    Array.prototype.forEach.call(nodes, function (node) {
      observer.observe(node);
    });
  }

  function render(posts) {
    feed.innerHTML = "";
    if (!posts.length) {
      meta.hidden = true;
      showStatus(EMPTY_MESSAGE, false);
      return;
    }

    showStatus("", false);
    countEl.textContent = posts.length === 1 ? "1 video" : posts.length + " videos";
    var updated = newestAddedAt(posts) || posts[0].created_at;
    updatedEl.textContent = "Last updated " + formatPacific(updated, true);
    meta.hidden = false;

    var frag = document.createDocumentFragment();
    posts.forEach(function (post) {
      var url = post.url || (post.id ? "https://x.com/i/status/" + post.id : "");
      var caption = (post.caption && String(post.caption).trim()) || fallbackCaption(post.text);
      var card = document.createElement("article");
      card.className = "card";

      var body = document.createElement("div");
      body.className = "card-body";

      var cap = document.createElement("p");
      cap.className = "caption";
      cap.textContent = caption;
      body.appendChild(cap);

      var byline = document.createElement("p");
      byline.className = "byline";
      var author = document.createElement("a");
      author.href = url || ("https://x.com/" + (post.author || ""));
      author.textContent = post.author ? "@" + post.author : "View post";
      if (url) {
        author.target = "_blank";
        author.rel = "noopener noreferrer";
      }
      byline.appendChild(author);
      var posted = formatPacific(post.created_at, true);
      if (posted) {
        byline.appendChild(document.createTextNode(" · " + posted));
      }
      body.appendChild(byline);
      card.appendChild(body);

      var embed = document.createElement("div");
      embed.className = "embed";
      if (url) embed.setAttribute("data-url", url);
      var placeholder = document.createElement("div");
      placeholder.className = "embed-placeholder";
      placeholder.textContent = "Loading video…";
      embed.appendChild(placeholder);
      card.appendChild(embed);

      frag.appendChild(card);
    });
    feed.appendChild(frag);
    observeEmbeds();
  }

  fetch(DATA_URL, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("Could not load videos");
      return res.json();
    })
    .then(function (data) {
      var posts = Array.isArray(data) ? data : [];
      render(posts);
    })
    .catch(function () {
      showStatus("The video list could not be loaded. Try refreshing in a moment.", true);
    });
})();
