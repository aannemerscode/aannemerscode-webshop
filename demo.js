// Start GroenBestek in demo-modus: de AI wordt nagebootst, dus geen API-sleutel nodig.
process.env.OFFERTE_DEMO = '1';
require('./server');
