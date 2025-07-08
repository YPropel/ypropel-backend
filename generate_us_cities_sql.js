const fs = require("fs");
const { State, City } = require("country-state-city");

const usStates = State.getStatesOfCountry("US");

let sql = "";

usStates.forEach((state) => {
  const cities = City.getCitiesOfState("US", state.isoCode);
  cities.forEach((city) => {
    // Escape single quotes in city names
    const cityName = city.name.replace(/'/g, "''");
    sql += `INSERT INTO us_cities (name, state_id) SELECT '${cityName}', id FROM us_states WHERE abbreviation = '${state.isoCode}';\n`;
  });
});

// Write SQL to file (optional if running manually)
fs.writeFileSync("us_cities_full.sql", sql);

console.log("✅ SQL for all US cities generated.");

