(function () {
  try {
    document.documentElement.style.background = "#050505";
    if (document.body) document.body.style.background = "#050505";
  } catch (_) {}

  window.setTimeout(function () {
    try {
      var root = document.getElementById("root");
      if (root && root.childNodes && root.childNodes.length > 0) return;
      var key = "flixit_boot_retry_v1";
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
      window.location.reload();
    } catch (_) {}
  }, 8000);

  window.addEventListener("load", function () {
    window.setTimeout(function () {
      try {
        var root = document.getElementById("root");
        if (root && root.childNodes && root.childNodes.length > 0) {
          window.sessionStorage.removeItem("flixit_boot_retry_v1");
        }
      } catch (_) {}
    }, 1500);
  }, { once: true });
})();
