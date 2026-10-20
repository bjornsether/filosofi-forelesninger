// Felles Firebase-oppstart for studentsiden, foreleser-siden og dekkene.
// Med ?emulator=1 i adressen kobles alt til Firebase-emulatoren på denne maskinen
// i stedet for det ekte prosjektet (til testing, se ../README.md).
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var emulator = params.get('emulator') === '1';

  // appName gir egen innlogging per side på samme adresse: foreleser-siden bruker
  // 'foreleser', så den ikke deler (og overskriver) studentsidens anonyme innlogging
  // hvis samme mobil brukes til begge.
  window.avstemningInit = function (appName) {
    var C = window.AVSTEMNING_CONFIG;
    var fbConfig = emulator
      ? { apiKey: 'demo-key', authDomain: 'demo-avstemning.firebaseapp.com', projectId: 'demo-avstemning' }
      : C.firebase;
    var app = appName ? firebase.initializeApp(fbConfig, appName) : firebase.initializeApp(fbConfig);
    var auth = app.auth();
    var db = app.firestore();
    if (emulator) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      db.useEmulator('127.0.0.1', 8080);
    }
    return {
      auth: auth,
      db: db,
      emulator: emulator,
      studentUrl: emulator ? 'http://127.0.0.1:5000' : C.studentUrl
    };
  };
})();
