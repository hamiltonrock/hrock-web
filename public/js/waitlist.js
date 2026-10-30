// Waitlist signups go to Netlify Forms (the build carries data-netlify="true").
// Shows Webflow's existing success / error blocks instead of leaving the page.
(function () {
  var local = /\.test$|^localhost$|^127\./.test(location.hostname);

  // not form[data-netlify]: Netlify strips that attribute from the published HTML
  document.querySelectorAll('.waitlist-form form').forEach(function (form) {
    var wrap = form.closest('.waitlist-form');
    var done = wrap.querySelector('.w-form-done');
    var fail = wrap.querySelector('.w-form-fail');

    function show(ok) {
      if (ok) { form.style.display = 'none'; if (done) done.style.display = 'block'; if (fail) fail.style.display = 'none'; }
      else if (fail) fail.style.display = 'block';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // The honeypot script (inline in the form) has already swallowed bot submits.
      if (local) { form.reset(); return show(true); } // no Netlify Forms in local dev
      var button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString(),
      })
        .then(function (r) { if (!r.ok) throw new Error(r.status); form.reset(); show(true); })
        .catch(function () { show(false); })
        .finally(function () { if (button) button.disabled = false; });
    });
  });
})();
