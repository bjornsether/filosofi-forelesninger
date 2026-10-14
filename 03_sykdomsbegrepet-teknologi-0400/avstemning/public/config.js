// Oppsett for avstemningen, brukes både av studentsiden (index.html her) og av
// forelesningsdekkene (via ../avstemning/public/config.js).
// Ingenting her er hemmelig: tilgangen styres av ../firestore.rules.
window.AVSTEMNING_CONFIG = {
  // Fra Firebase-konsollen: Project settings > General > Your apps > firebaseConfig
  firebase: {
    apiKey: 'AIzaSyB7VkXpsg1p-T8ECb1bfJLOCaVrzuhhDQ4',
    authDomain: 'filosofiforelesninger.firebaseapp.com',
    projectId: 'filosofiforelesninger',
    storageBucket: 'filosofiforelesninger.firebasestorage.app',
    messagingSenderId: '757677880322',
    appId: '1:757677880322:web:9220f58fea1145d3cc631b'
  },
  // Adressen studentene går til (QR-koden på join-sliden peker hit)
  studentUrl: 'https://filosofiforelesninger.web.app'
};
