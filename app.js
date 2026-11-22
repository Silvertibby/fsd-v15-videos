(function () {
  "use strict";

  var DATA_URL = "data/videos.json";
  var TAGS_URL = "data/tags.json";
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
  var controls = document.getElementById("controls");
  var tagBar = document.getElementById("tag-bar");
  var searchInput = document.getElementById("search");
  var clearBtn = document.getElementById("clear");
  var filterMeta = document.getElementById("filter-meta");
  var matchRow = document.getElementById("match-row");
  var matchAnyBtn = document.getElementById("match-any");
  var matchAllBtn = document.getElementById("match-all");

  var allPosts = [];
  var tagVocab = [];
  var tagById = {};
  var state = { tags: [], q: "", match: "any" };
  var searchTimer = null;

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

  function postTags(post) {
    var tags = post.tags;
    if (!Array.isArray(tags) || !tags.length) return ["general-driving"];
    return tags.filter(function (id) { return tagById[id]; });
  }

  function readStateFromURL() {
    var params = new URLSearchParams(window.location.search);
    var tags = params.getAll("tag").filter(function (id) { return tagById[id]; });
    var unique = [];
    tags.forEach(function (id) {
      if (unique.indexOf(id) === -1) unique.push(id);
    });
    return {
      tags: unique,
      q: params.get("q") || "",
      match: params.get("match") === "all" ? "all" : "any"
    };
  }

  function writeURL(push) {
    var params = new URLSearchParams();
    state.tags.forEach(function (id) { params.append("tag", id); });
    if (state.q) params.set("q", state.q);
    if (state.match === "all" && state.tags.length > 1) params.set("match", "all");
    var qs = params.toString();
    var next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    var method = push ? "pushState" : "replaceState";
    history[method]({ tags: state.tags, q: state.q, match: state.match }, "", next);
  }

  function hasActiveFilters() {
    return state.tags.length > 0 || state.q.length > 0 || (state.match === "all" && state.tags.length > 1);
  }

  function matchesSearch(post, q) {
    if (!q) return true;
    var hay = [
      post.caption || "",
      post.author || "",
      post.text || "",
      post.url || ""
    ];
    postTags(post).forEach(function (id) {
      hay.push(id);
      if (tagById[id]) hay.push(tagById[id].label);
    });
    var blob = hay.join(" ").toLowerCase();
    return blob.indexOf(q) !== -1;
  }

  function matchesTags(post) {
    if (!state.tags.length) return true;
    var tags = postTags(post);
    if (state.match === "all") {
      return state.tags.every(function (id) { return tags.indexOf(id) !== -1; });
    }
    return state.tags.some(function (id) { return tags.indexOf(id) !== -1; });
  }

  function filteredPosts() {
    var q = state.q.trim().toLowerCase();
    return allPosts.filter(function (post) {
      return matchesSearch(post, q) && matchesTags(post);
    });
  }

  function tagCounts() {
    var counts = {};
    tagVocab.forEach(function (t) { counts[t.id] = 0; });
    allPosts.forEach(function (post) {
      postTags(post).forEach(function (id) {
        if (counts[id] != null) counts[id] += 1;
      });
    });
    return counts;
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

  function setTag(id, on) {
    var next = state.tags.filter(function (t) { return t !== id; });
    if (on) next.push(id);
    state.tags = next;
    if (state.tags.length < 2) state.match = "any";
    writeURL(true);
    render();
  }

  function toggleTag(id) {
    setTag(id, state.tags.indexOf(id) === -1);
  }

  function clearFilters() {
    state = { tags: [], q: "", match: "any" };
    searchInput.value = "";
    writeURL(true);
    render();
  }

  function renderControls() {
    var counts = tagCounts();
    tagBar.innerHTML = "";

    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "tag-chip";
    allBtn.setAttribute("aria-pressed", state.tags.length === 0 ? "true" : "false");
    allBtn.textContent = "All";
    var allCount = document.createElement("span");
    allCount.className = "n";
    allCount.textContent = String(allPosts.length);
    allBtn.appendChild(document.createTextNode(" "));
    allBtn.appendChild(allCount);
    allBtn.addEventListener("click", function () {
      state.tags = [];
      state.match = "any";
      writeURL(true);
      render();
    });
    tagBar.appendChild(allBtn);

    tagVocab.forEach(function (tag) {
      var n = counts[tag.id] || 0;
      if (!n) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-chip";
      btn.setAttribute("aria-pressed", state.tags.indexOf(tag.id) !== -1 ? "true" : "false");
      btn.appendChild(document.createTextNode(tag.label + " "));
      var count = document.createElement("span");
      count.className = "n";
      count.textContent = String(n);
      btn.appendChild(count);
      btn.title = tag.definition || tag.label;
      btn.addEventListener("click", function () { toggleTag(tag.id); });
      tagBar.appendChild(btn);
    });

    matchRow.hidden = state.tags.length < 2;
    matchAnyBtn.setAttribute("aria-pressed", state.match !== "all" ? "true" : "false");
    matchAllBtn.setAttribute("aria-pressed", state.match === "all" ? "true" : "false");

    if (searchInput.value !== state.q) searchInput.value = state.q;
    clearBtn.hidden = !hasActiveFilters();

    var shown = filteredPosts().length;
    if (hasActiveFilters()) {
      filterMeta.hidden = false;
      var bits = [];
      bits.push(shown === 1 ? "Showing 1 video" : "Showing " + shown + " of " + allPosts.length + " videos");
      if (state.tags.length) {
        var labels = state.tags.map(function (id) { return tagById[id] ? tagById[id].label : id; });
        bits.push((state.match === "all" ? "all of " : "tagged ") + labels.join(", "));
      }
      if (state.q) bits.push('matching “' + state.q + '”');
      filterMeta.textContent = bits.join(" · ");
    } else {
      filterMeta.hidden = true;
      filterMeta.textContent = "";
    }
  }

  function renderFeed(posts) {
    feed.innerHTML = "";
    if (!allPosts.length) {
      meta.hidden = true;
      showStatus(EMPTY_MESSAGE, false);
      return;
    }

    if (!posts.length) {
      showStatus("No videos match these filters.", false);
      return;
    }

    showStatus("", false);
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

      var tags = postTags(post);
      if (tags.length) {
        var row = document.createElement("div");
        row.className = "card-tags";
        tags.forEach(function (id) {
          var info = tagById[id];
          var chip = document.createElement("button");
          chip.type = "button";
          chip.className = "card-chip" + (state.tags.indexOf(id) !== -1 ? " is-active" : "");
          chip.textContent = info ? info.label : id;
          if (info && info.definition) chip.title = info.definition;
          chip.addEventListener("click", function () { toggleTag(id); });
          row.appendChild(chip);
        });
        body.appendChild(row);
      }

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

  function render() {
    if (!allPosts.length) {
      controls.hidden = true;
      renderFeed([]);
      return;
    }
    controls.hidden = false;
    countEl.textContent = allPosts.length === 1 ? "1 video" : allPosts.length + " videos";
    var updated = newestAddedAt(allPosts) || allPosts[0].created_at;
    updatedEl.textContent = "Last updated " + formatPacific(updated, true);
    meta.hidden = false;
    renderControls();
    renderFeed(filteredPosts());
  }

  searchInput.addEventListener("input", function () {
    var value = searchInput.value;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      state.q = value;
      writeURL(false);
      render();
    }, 150);
  });

  clearBtn.addEventListener("click", clearFilters);
  matchAnyBtn.addEventListener("click", function () {
    state.match = "any";
    writeURL(true);
    render();
  });
  matchAllBtn.addEventListener("click", function () {
    state.match = "all";
    writeURL(true);
    render();
  });
  window.addEventListener("popstate", function () {
    state = readStateFromURL();
    render();
  });

  Promise.all([
    fetch(DATA_URL, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load videos");
      return res.json();
    }),
    fetch(TAGS_URL, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load tags");
      return res.json();
    })
  ])
    .then(function (results) {
      allPosts = Array.isArray(results[0]) ? results[0] : [];
      tagVocab = Array.isArray(results[1]) ? results[1] : [];
      tagById = {};
      tagVocab.forEach(function (tag) { tagById[tag.id] = tag; });
      state = readStateFromURL();
      render();
    })
    .catch(function () {
      showStatus("The video list could not be loaded. Try refreshing in a moment.", true);
    });
})();
