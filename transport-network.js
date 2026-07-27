/* ============================================================
   COMMUTE GUIDE PH
   Transport Network Database

   Contains:
   - Jeepneys
   - Buses
   - UV Express
   - MRT/LRT
   - Tricycles

   Used by route-engine.js
============================================================ */

window.TRANSPORT_NETWORK = {

  places: [

    {
      id: "balibago-complex",
      name: "Balibago Complex",
      type: "terminal",
      coordinates: {
        lat: 14.2374,
        lng: 121.1361
      }
    },

    {
      id: "crossing-calamba",
      name: "Crossing Calamba",
      type: "terminal",
      coordinates: {
        lat: 14.2117,
        lng: 121.1653
      }
    },

    {
      id: "liliw-municipal-hall",
      name: "Liliw Municipal Hall",
      type: "destination",
      coordinates: {
        lat: 14.1328,
        lng: 121.4115
      }
    }

  ],


  jeepneys: [

    {
      id: "balibago-crossing-jeep",

      operator: "Balibago Jeep Operators",

      mode: "jeep",

      name: "Balibago - Crossing Jeep",


      origin: {
        placeId: "balibago-complex"
      },


      destination: {
        placeId: "crossing-calamba"
      },


      stops: [

        {
          order: 1,
          placeId: "balibago-complex",
          name: "Balibago Jeep Terminal"
        },

        {
          order: 2,
          name: "WalterMart Santa Rosa",
          coordinates:{
            lat:14.2358,
            lng:121.1375
          }
        },


        {
          order: 3,
          placeId:"crossing-calamba",
          name:"Crossing Calamba"
        }

      ],


   fare: {
  min: 15,
  max: 25,
  currency: "PHP"
},


      estimatedTime:25

    }

  ],


  buses: [],

  uvExpress: [],

  trains: [],

  tricycles: []

};
