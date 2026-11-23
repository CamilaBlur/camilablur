(() => {
  const privacy = document.getElementById('login-privacy');
  if (!privacy || new URLSearchParams(location.search).get('backupOnly') === '1') return;

  // Wait for FlutterFire to initialize its own Auth instance. Creating a
  // second instance here could interfere with Flutter's login persistence.
  const deadline = performance.now() + 90_000;
  function observeAuth() {
    const app = window.firebase_core?.getApps().find(({name}) => name === '[DEFAULT]');
    const authProvider = app?.container?.getProvider('auth');
    if (!authProvider) {
      if (performance.now() < deadline) setTimeout(observeAuth, 250);
      return;
    }
    authProvider.onInit(auth => {
      auth.onAuthStateChanged(user => {
        privacy.hidden = user !== null;
      });
    });
  }

  observeAuth();
})();
