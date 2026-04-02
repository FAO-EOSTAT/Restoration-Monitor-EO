// ----------------------------------------------------------------------------
//  EOSTAT Monitor-EO Tool - Difference-in-Differences Analysis for Restoration
//  Author: FAO ESA Geospatial
//  Description: This Earth Engine app loads restoration project polygons,
//  generates control areas, and computes DiD for NDVI, LST, and NDWI using
//  MODIS time series.
// ----------------------------------------------------------------------------
/* ---------------------------------- IMPORTS ---------------------------------- */
var drawingTools = require('users/ocsgeospatial/functions:drawing_tools.js');


/* ------------------------------- CONFIG ---------------------------------- */
var CONFIG = {
  assets: {
    africa: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/africa_v4',
    asia: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/asia_v4',
    northAmerica: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/north_america_v5_',
    southAmerica: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/south_americav4',
    oceania: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/oceaniav4',
    europe: 'projects/ee-ocsgeospatial/assets/CarbonOffsetData/europev4'
  },
  controlBufferMeters: 2000,
  randomControlAttempts: 20,
  chartScale: 500,
  exportEnabled: false
};

/**
 * Metric configuration used to standardize data loading and preprocessing.
 * Each metric defines:
 * - collection: source ImageCollection
 * - band: output band name used downstream
 * - scaleFactor: applied to raw imagery
 * - viz: map visualization parameters
 */
var METRICS = {
  NDVI: {
    label: 'Normalized Difference Vegetation Index',
    collection: 'MODIS/006/MOD13A1',
    band: 'NDVI',
    scaleFactor: 0.0001,
    viz: {
      min: 0,
      max: 1,
      palette: ['ffffff', 'ce7e45', 'df923d', 'f1b555', 'fcd163', '99b718', '74a901', '66a000', '529400', '3e8601', '207401', '056201', '004c00', '023b01', '012e01', '011d01', '011301']
    },
    prepare: function(image) {
      return image.select('NDVI').multiply(0.0001).copyProperties(image, ['system:time_start']);
    }
  },
  LST: {
    label: 'Land Surface Temperature',
    collection: 'MODIS/061/MOD11A2',
    band: 'LST_Day_1km',
    scaleFactor: 0.02,
    viz: {
      min: 275,
      max: 340,
      palette: ['040274', '040281', '0502a3', '0502b6', '0502ce', '0502e6', '0602ff', '235cb1', '307ef3', '269db1', '30c8e2', '32d3ef', '3be285', '3ff38f', '86e26f', '3ae237', 'b5e22e', 'd6e21f', 'fff705', 'ffd611', 'ffb613', 'ff8b13', 'ff6e08', 'ff500d', 'ff0000', 'de0101', 'c21301', 'a71001', '911003']
    },
    prepare: function(image) {
      return image.select('LST_Day_1km').multiply(0.02).copyProperties(image, ['system:time_start']);
    }
  },
  NDWI: {
    label: 'Normalized Difference Water Index',
    collection: 'MODIS/061/MOD09A1',
    band: 'NDWI',
    scaleFactor: 1,
    viz: {
      min: -0.5,
      max: 0.5,
      palette: ['0000ff', '00ffff', 'ffff00', 'ff0000', 'ffffff']
    },
    prepare: function(image) {
      return image
        .normalizedDifference(['sur_refl_b04', 'sur_refl_b02'])
        .rename('NDWI')
        .copyProperties(image, ['system:time_start']);
    }
  }
};
/* ------------------------------- DATA ------------------------------------ */
/**
 * Load and merge restoration project boundaries from all regional assets.
 * The merged FeatureCollection is sorted by country for UI dropdown display.
 * @returns {ee.FeatureCollection}
 */
function loadProjects() {
  return ee.FeatureCollection(CONFIG.assets.africa)
    .merge(ee.FeatureCollection(CONFIG.assets.asia))
    .merge(ee.FeatureCollection(CONFIG.assets.northAmerica))
    .merge(ee.FeatureCollection(CONFIG.assets.southAmerica))
    .merge(ee.FeatureCollection(CONFIG.assets.oceania))
    .merge(ee.FeatureCollection(CONFIG.assets.europe))
    .sort('Country');
}

var PROJECTS = loadProjects();

/* ---------------------------- UI WIDGETS ------------------------------- */
// Logo (now part of side panel)
var Logo_FAO = ee.Image("projects/ee-ocsgeospatial/assets/CarbonOffsetData/logo_proj").resample('bicubic').resample('bicubic');
var logo_fao = ui.Thumbnail({
  image: Logo_FAO,
  params: { bands: ['b1', 'b2', 'b3'], min: 0, max: 255 },
  style: { width: '90px', height: 'auto', margin: 'auto' }
});

var logo = ui.Panel({
  style: { width: '110px', height: 'auto', padding: '10px', position: 'bottom-right' }, // will be inside panel, position ignored
  widgets: [logo_fao]
});

var header = ui.Label('EOSTAT Monitor-EO Tool', { fontSize: '24px', color: 'green' });
var text = ui.Label(
  'Developed by the ESA Division of the FAO, this tool uses large Earth Observation (EO) and Artificial Intelligence (AI) data to monitor the impact of restoration projects on the ground, vegetation, and water. It analyzes changes in NDVI, LST, and NDWI, applying an AI-automated case–control design to infer causality. Each intervened site is compared with:',
  { fontSize: '14px' }
);

var con1 = ui.Label('• Control area 1 = 2km Buffer', { fontSize: '14px' });
var con2 = ui.Label('• Control area 2 = Random area (similar size as restoration area)', { fontSize: '14px' });
var con3 = ui.Label('• Control area 3 = A user-defined control area (optional)', { fontSize: '14px' });

var ControlAreaPanel = ui.Label("Because of proximity, the intervention area and the control areas can be considered similar in the biophysical and agroecological conditions.",{fontSize: '14px'});
var demolabel = ui.Label('DEMO',{fontSize: '14px',fontWeight: 'bold'})
var demodescription = ui.Label('For the demonstration of the EOSTAT M&E Tool, we have integrated in the system a database of 503 restoration project sites extracted from the work of Karnik et al., 2024,  An open-access database of nature-based carbon offset project boundaries) ',{fontSize: '14px'})
 
var indicatorSelectionPanel = ui.Label('Select an indicator to visualize:',{fontSize: '14px',fontWeight: 'bold'});
var chartdetailPanelndvi = ui.Label('The "Average NDVI Time-series Analysis" compares the monthly average Normalized Difference Vegetation Index (NDVI) for restoration and control areas from 3 years before project start to 2024. In this chart:' ,{fontSize: '14px'})
var chartdetailndvi1 = ui.Label('• The NDVI for the restoration area is displayed in green.',{fontSize: '14px'})
var chartdetailndvi2 = ui.Label('• The NDVI for the control area is displayed in red.',{fontSize: '14px'})
var chartdetailPanelndviDiff = ui.Label('The "NDVI Difference (Restoration area - Control area)" chart illustrates the difference in NDVI between the restoration and control areas over time. This highlights changes in vegetation health and the effectiveness of restoration efforts.' ,{fontSize: '14px'})
var chartdetailPanelndviCumDiff = ui.Label('The "Cumulative NDVI Difference (Restoration area - Control area)" chart tracks the cumulative difference in NDVI over time, providing insights into the long-term impact of restoration activities.' ,{fontSize: '14px'})
var chartdetailPanelst = ui.Label('The "Average LST Time-series Analysis" compares the monthly average Land Surface Temperature (LST) for restoration and control areas from 3 years before project start to 2024. In this chart:' ,{fontSize: '14px'})
var chartdetaillst1 = ui.Label('•	The LST for the restoration area is displayed in green.',{fontSize: '14px'})
var chartdetaillst2 = ui.Label('•	The LST for the control area is displayed in red.',{fontSize: '14px'})
var chartdetailPanellstDiff = ui.Label('The "LST Difference (Restoration area - Control area)" chart illustrates the difference in LST between the restoration and control areas over time. This highlights changes in land surface temperature.' ,{fontSize: '14px'} )
var chartdetailPanellstCumDiff = ui.Label('The "Cumulative LST Difference (Restoration area - control area)" chart tracks the cumulative difference in LST over time, providing insights into the long-term impact of restoration activities.' ,{fontSize: '14px'})
var chartdetailPanelndwi = ui.Label('The "Average NDWI Time-series Analysis" compares the monthly average Normalized Difference Water Index (NDWI) for restoration and control areas from 3 years before project start to 2024. In this chart:' ,{fontSize: '14px'} )
var chartdetailndwi1 = ui.Label('•	The NDWI for the restoration area is displayed in green.',{fontSize: '14px'})
var chartdetailndwi2 = ui.Label('•	The NDWI for the control area is displayed in red.',{fontSize: '14px'})
var chartdetailPanelndwiDiff = ui.Label('The "NDWI Difference (Restoration area - Control area)" chart illustrates the difference in NDWI between the restoration and control areas over time. This highlights changes in water content in vegetation.' ,{fontSize: '14px'})
var chartdetailPanelndwiCumDiff = ui.Label('The "Cumulative NDWI Difference (Restoration area - control area)" chart tracks the cumulative difference in NDWI over time, providing insights into the long-term impact of restoration activities.' ,{fontSize: '14px'} )
var panelndviDID = ui.Panel({style: { width: '300px', position: 'top-right', padding: '8px' }});

var plotsDD = ui.Select([], 'Loading .....');
var plots = {};
  

// Function to create reference panel.
var referenceZero = ui.Label({ value: 'Restoration area data Source:', style: { color: 'black', fontWeight: 'bold',textAlign: 'center'  },});
var referenceOne = ui.Label({value: 'data source',style: {fontSize: '14px',
            color: 'black',
            fontWeight: 'bold',
            textAlign: 'center'
        },
        targetUrl: 'https://doi.org/10.5281/zenodo.11459391'
    });
var referenceTwo = ui.Label({
        value: 'Paper',
        style: {
            color: 'black',
            fontWeight: 'bold',
            textAlign: 'center',
            padding: '0px 0px 4px 0px'
        },
        targetUrl: 'https://www.frontiersin.org/journals/environmental-science/articles/10.3389/fenvs.2024.1352058/full'
    });
var classification_names = ['Restoration area', 'Contol area 1','Control area 2' ]       
 
var classification_palette = [
  "6BFF33", // 1.restoration area
  "FF0000", //2. control area 1
  "f58c75"] // 3.control area 2

/* ---------------------------------- UI HELPERS ------------------------------- */

// Function for generating legend
function makeLegend(title, palette, class_names, class_length){

  var legend = ui.Panel({ style: {position: 'bottom-left',padding: '12px 15px' }});

  var legendTitle = ui.Label({ value: title, style: { fontWeight: 'bold', fontSize: '18px', margin: '0 0 4px 0',padding: '0' }});

  // Add the title to the panel
  legend.add(legendTitle);

  // Creates and styles 1 row of the legend.
  var makeRow = function(color, name) {
        // Create the label that is actually the colored box.
        var colorBox = ui.Label({
          style: {
            backgroundColor: color,
            // Use padding to give the box height and width.
            padding: '8px',
            fontSize: '12px',
            margin: '0 0 4px 0'
          }
        });

        // Create the label filled with the description text.
        var description = ui.Label({
          value: name,
          style: {margin: '0 0 4px 6px'}
        });

        // return the panel
        return ui.Panel({
          widgets: [colorBox, description],
          layout: ui.Panel.Layout.Flow('horizontal')
        });
  };

  // Add color and and names
  for (var i = 0; i <= class_length; i++) {
    legend.add(makeRow(palette[i], class_names[i]));
    }

  return legend
}


// Function to populate the color palette legends for the app layers
function populateLegend(legend_name, viz_params, add_char_min, add_char_max, options){

    var legend = ui.Panel({style: {position: 'bottom-left',padding: '12px 15px'}});

    // Create legend title
    var legend_title = ui.Label({value: legend_name,style: {fontWeight: 'bold',fontSize: '18px',margin: '0 0 0 0',padding: '0'}});

    // Add the title to the pane
    legend.add(legend_title);

    // create the legend image
    var lon = ee.Image.pixelLonLat().select('latitude');
    var gradient = lon.multiply(ee.Number(viz_params.max).subtract(viz_params.min).divide(100)).add(viz_params.min);
    var legend_image = options.legend_image || gradient.visualize(viz_params);

    // create text on top of legend
    var legend_panel_max = ui.Panel({
      widgets: [
      ui.Label(viz_params['max'] + add_char_max)
      ],
      });

    legend.add(legend_panel_max);

    // create thumbnail from the image
    var thumbnail = ui.Thumbnail({
      image: legend_image ,
      params: {bbox: '0,0,10,100', dimensions:'10x25'},
      style: {padding: '1px', position: 'bottom-center', fontSize: '18px'}
      });

    // add the thumbnail to the legend
    legend.add(thumbnail);

    // create text on top of legend
    var legend_panel_min = ui.Panel({
      widgets: [
      ui.Label(viz_params['min'] + add_char_min)
      ],
      });

    legend.add(legend_panel_min);

    return legend
}

        
var legend = makeLegend("Legend", classification_palette, classification_names, 2)

/**
 * Clip an image to the supplied analysis geometry.
 * Used to limit calculations and map display to the selected project/control area.
 * @param {ee.Image} image
 * @param {ee.Geometry|ee.FeatureCollection} geometry
 * @returns {ee.Image}
 */
function clipToGeometry(image, geometry) {
  return image.clip(geometry);
}
/**
 * Create a binary non-water mask using JRC Global Surface Water.
 * Pixels classified as permanent/max water extent are removed from analysis.
 * @param {ee.Geometry|ee.FeatureCollection} geometry
 * @returns {ee.Image}
 */
function getNonWaterMask(geometry) {
  return ee.Image('JRC/GSW1_2/GlobalSurfaceWater')
    .clip(geometry)
    .select('max_extent')
    .eq(0);
}

function applyNonWaterMask(image, geometry) {
  return image.updateMask(getNonWaterMask(geometry));
}



// Function to parse date string to readable format
var formatDate = function(dateString) {
  var date = ee.Date(dateString);
  return date.format('yyyy-MM-dd').getInfo();
};


// Define a function to parse the date string and convert it to a GEE Date object
function parseDate(dateString) {
  // Ensure the date string is not null or empty
  dateString = ee.String(dateString);
  var dateFormatCorrect = dateString.match('^[0-1][0-9]/[0-3][0-9]/[0-9]{4}$'); // Check for MM/dd/yyyy format
  return ee.Algorithms.If(dateFormatCorrect,
    // If the format is correct, parse the date
    ee.Algorithms.If(dateString.length().gt(0),
      ee.Date.parse('MM/dd/yyyy', dateString),
      null
    ),
    // If the format is incorrect, return null
    null
  );
}
/**
 * Build a cumulative anomaly/difference series from a time-ordered ImageCollection.
 * Assumes the collection is already sorted by 'system:time_start'.
 * Missing timestamps are not filled; cumulative values are computed only for available images.
 * @param {ee.Image} image
 * @param {ee.List} list
 * @returns {ee.List}
 */
//anomaly images are added to the list
var accumulate = function(image,list){
  //get last image in the image collection
  var previous = ee.Image(ee.List(list).get(-1));
  //Add the current anomaly to make a new cumulative anomaly image
  var added  = image.add(previous)
                          .set('system:time_start',image.get('system:time_start'));
  //return list with cumulative anomaly inserted
  return ee.List(list).add(added);
        }

/**
 * Aggregate an ImageCollection into monthly mean images.
 * One image is produced per year-month combination, with 'system:time_start'
 * set to the first day of that month for charting.
 * @param {ee.ImageCollection} imageCollection
 * @returns {ee.ImageCollection}
 */
function calcMonthlyMean(imageCollection) {
  // Get the range of years within the image collection
  var yearRange = imageCollection.aggregate_array('system:time_start')
    .map(function(date) {
      return ee.Date(date).get('year');
    }).distinct().sort();
  
  var months = ee.List.sequence(1, 12); // Create a list of months from 1 to 12
  
  // Map over each year and each month to calculate the monthly mean
  var monthlyMeans = yearRange.map(function(y) {
    return months.map(function(m) {
      var monthCollection = imageCollection.filter(ee.Filter.calendarRange(y, y, 'year'))
                                           .filter(ee.Filter.calendarRange(m, m, 'month'))
                                           .mean();
      var monthImage = monthCollection.set('year', y)
                                      .set('month', m)
                                      .set('date', ee.Date.fromYMD(y, m, 1))
                                      .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis());
      return monthImage;
    });
  }).flatten(); // Flatten the list of lists into a single list
  
  return ee.ImageCollection.fromImages(monthlyMeans);
}

//clip function
function clipToFeatureCollection(image, featureCollection) {
      return image.clip(featureCollection);
    }        

function comprobeBandsNumber(ele) {
  // Ensure 'ele' is treated as an image
  var img = ee.Image(ele);
  // Get the number of bands
  var count = img.bandNames().size();
  // If it has only one band, keep it; otherwise, return null (not 0, since 0 is not an image)
  var comp = ee.Algorithms.If(count.eq(1), img, ee.Image(0).rename('empty'));
  // Wrap result in a list for safe flattening later
  var new_list = ee.List([comp]);
  return new_list;
}

// Function to extract date properties from features 
function extractDates(collection, propertyName) {
    return collection.aggregate_array(propertyName);
  }
  

// Helper function to convert date strings to the correct format ie from 'MM/DD/YYYY' to an ee.Date.
function convertToDateFormat(dateStr) {
// Convert the string to a date object
var dateParts = ee.List(ee.String(dateStr).split('/'));

dateParts  = dateParts.map(function (number) { return ee.Number.parse(number); });
var formattedDate = ee.Date.fromYMD(
  dateParts.get(2),  // Year
  dateParts.get(0),  // Month
  dateParts.get(1)   // Day
);
// Format the date in yyyy/mm/dd format
var output = formattedDate.format('yyyy-MM-dd');
return output
}

var mask_water = function(roi){
  var jrc_water= ee.Image("JRC/GSW1_2/GlobalSurfaceWater").clip(roi);
  var not_water = jrc_water.select('max_extent').eq(0);  
  return not_water}
  
function comprobeBandsNumber(collection) {
  return collection.map(function(ele) {
    var new_list = ee.List([]);
    
    var count = ee.Image(ele).bandNames().size();
    
    var comp = ee.Algorithms.If(count.eq(1), ele, 0);
    
    new_list = new_list.add(comp);
    
    return new_list;
  }).flatten();
}
/* ------------------------------ ANALYSIS --------------------------------- */
/**
 * Load and preprocess a metric-specific ImageCollection for a region and period.
 * Steps:
 * 1. filter by bounds and date
 * 2. derive/select the target metric band
 * 3. clip to region
 * 4. mask non-water pixels
 * 5. apply scale factor
 *
 * Note: NDWI is derived from MODIS surface reflectance bands rather than selected directly.
 *
 * @param {string} metricKey - One of 'NDVI', 'LST', 'NDWI'
 * @param {ee.Geometry|ee.FeatureCollection} geometry
 * @param {string|ee.Date} startDate
 * @param {string|ee.Date} endDate
 * @returns {ee.ImageCollection}
 */
function loadMetricCollection(metricKey, geometry, startDate, endDate) {
  var metric = METRICS[metricKey];
  var collection = ee.ImageCollection(metric.collection)
    .filterBounds(geometry)
    .filterDate(startDate, endDate);

  // Derive metric directly here
  if (metricKey === 'NDWI') {
    collection = collection.map(function(image) {
      return image.normalizedDifference(['sur_refl_b04', 'sur_refl_b02'])
                  .rename('NDWI')
                  .copyProperties(image, ['system:time_start']);
    });
  } else {
    collection = collection.select(metric.band);
  }

  return collection.map(function(image) {
    var original = image;
    image = clipToGeometry(image, geometry);
    image = applyNonWaterMask(image, geometry);
    image = image.multiply(metric.scaleFactor).rename(metric.band);
    return image.copyProperties(original, ['system:time_start']);
  });
}
/**
 * Compute the Difference-in-Differences estimator:
 * (afterTreatment - beforeTreatment) - (afterControl - beforeControl)
 * @param {ee.Number} beforeTreatment
 * @param {ee.Number} afterTreatment
 * @param {ee.Number} beforeControl
 * @param {ee.Number} afterControl
 * @returns {ee.Number}
 */
function computeDid(beforeTreatment, afterTreatment, beforeControl, afterControl) {
  return ee.Number(afterTreatment).subtract(beforeTreatment)
    .subtract(ee.Number(afterControl).subtract(beforeControl));
}

function meanOverGeometry(imageCollection, bandName, geometry, scale) {
  var meanImage = imageCollection.mean();
  return meanImage.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geometry, scale: scale,
    maxPixels: 1e13, bestEffort: true
  }).get(bandName);
}
/**
 * Compute the DiD coefficient for a selected metric using restoration and control geometries.
 * The baseline period starts 3 years before project start and ends at project start.
 * The intervention period runs from project start to project end.
 * @param {string} metricKey
 * @param {ee.Geometry} restorationGeometry
 * @param {ee.Geometry|ee.FeatureCollection} controlGeometry
 * @param {ee.Date|string} monitoringStart
 * @param {ee.Date|string} startDate
 * @param {ee.Date|string} endDate
 * @returns {ee.Number}
 */
function computeDidForMetric(metricKey, restorationGeometry, controlGeometry, monitoringStart, startDate,endDate) {
  var metric = METRICS[metricKey];
  var beforeTreatment = loadMetricCollection(metricKey, restorationGeometry,monitoringStart, startDate);
  var afterTreatment = loadMetricCollection(metricKey, restorationGeometry, startDate, endDate);
  var beforeControl = loadMetricCollection(metricKey, controlGeometry,monitoringStart, startDate);
  var afterControl = loadMetricCollection(metricKey, controlGeometry, startDate, endDate);
  return computeDid(
    meanOverGeometry(beforeTreatment, metric.band, restorationGeometry, CONFIG.chartScale),
    meanOverGeometry(afterTreatment, metric.band, restorationGeometry, CONFIG.chartScale),
    meanOverGeometry(beforeControl, metric.band, controlGeometry, CONFIG.chartScale),
    meanOverGeometry(afterControl, metric.band, controlGeometry, CONFIG.chartScale)
  );
}



/* ----------------------------- TIME SERIES CHARTS ----------------------- */
/**
 * Create a treatment vs control time-series chart from a combined collection.
 * Expected input: ImageCollection with matching timestamps and a common band name.
 */
function createSeriesByRegionChart(comb, regions, bandName, scale, title, vAxisTitle) {
  return ui.Chart.image.seriesByRegion(
    comb,
    regions,
    ee.Reducer.mean(),
    bandName,
    scale
  )
  .setChartType('LineChart')
  .setSeriesNames(['Restoration area', 'Control areas'])
  .setOptions({
    interpolateNulls: true,
    lineWidth: 1,
    pointSize: 3,
    title: title,
    hAxis: {title: 'Time', format: 'YYYY'},
    vAxis: {title: vAxisTitle},
    series: {
      0: {
        targetAxisIndex: 0,
        type: 'line',
        lineWidth: 1,
        pointSize: 0,
        color: '6BFF33'
      },
      1: {
        targetAxisIndex: 0,
        type: 'line',
        lineWidth: 1,
        pointSize: 0,
        color: 'FF0000'
      }
    }
  });
}
/**
 * Create a chart of restoration minus control differences through time.
 * Expected input: an ImageCollection where each image already represents a difference.
 */
function createDiffChart(imageCollection, regions, scale, title, vAxisTitle, seriesProperty) {
  return ui.Chart.image.seriesByRegion({
    imageCollection: imageCollection,
    regions: regions,
    reducer: ee.Reducer.mean(),
    scale: scale,
    xProperty: 'system:time_start',
    seriesProperty: seriesProperty
  })
  .setChartType('LineChart')
  .setOptions({
    title: title,
    hAxis: {title: 'Time', format: 'YYYY'},
    vAxis: {title: vAxisTitle},
    trendlines: {
      0: {
        type: 'linear',
        color: 'red',
        lineWidth: 2,
        opacity: 0.8,
        showR2: true
      }
    }
  });
}
/**
 * Create a cumulative difference chart from a precomputed cumulative ImageCollection.
 * Expected input: a time-ordered cumulative ImageCollection with numeric 'system:time_start'.
 */
function createCumulativeDiffChart(imageCollection, regions, scale, title, vAxisTitle, seriesProperty) {
  return ui.Chart.image.seriesByRegion({
    imageCollection: imageCollection,
    regions: regions,
    reducer: ee.Reducer.mean(),
    scale: scale,
    xProperty: 'system:time_start',
    seriesProperty: seriesProperty
  })
  .setOptions({
    title: title,
    hAxis: {title: 'Time'},
    vAxis: {title: vAxisTitle}
  });
}
//**************************************** UI- POPULATE DD ***************************************************//

var mapPanel = ui.Map();
var projectdetailP = ui.Panel();
// Call back function to zoom to restoration area
var zoomButton = ui.Button({label:'Zoom to restoration area & control areas', style: {width: '150px', height: '50px', fontSize: 30, fontWeight: 'bold'}});
// Create a panel to display the start and end dates
var datePanel = ui.Panel();
// Create the drop-down menu for countries
var statesDD = ui.Select([], 'Select a country');
// Create the drop-down menu for restoration areas
var CountryDD = ui.Select([], 'Select a restoration area');
// Load and display the initial country names
var statesNames = PROJECTS.aggregate_array('Country').distinct();
statesNames.evaluate(function(states){
  //print('Loaded countries:', states);  // Logging loaded countries
  statesDD.items().reset(states);
  statesDD.setPlaceholder('Select a country');
});
// Event handler for when a country is selected
statesDD.onChange(function(selectedState){
  // Set placeholder text while loading the restoration areas
  CountryDD.setPlaceholder('Loading...');
  
  
// Filter the dataset to get the restoration areas for the selected country
var filteredData = PROJECTS.filter(ee.Filter.eq('Country', selectedState));
var counties = filteredData.aggregate_array('ProjectID').distinct();
  counties.evaluate(function(countiesNames){
    //print('Loaded restoration areas:', countiesNames);
    // Populate the restoration areas drop-down with the filtered data
    if (countiesNames.length > 0) {
        CountryDD.items().reset(countiesNames);
        CountryDD.setPlaceholder('Select a restoration area');
    } else {
        CountryDD.items().reset([]);
        CountryDD.setPlaceholder('No restoration areas found');
    }
    // Populate the restoration areas drop-down with the filtered data
    CountryDD.items().reset(countiesNames);
    CountryDD.setPlaceholder('Select a restoration area');
  });
});


//**************************************** UI - UTILITIES ***************************************************//
// Check starting date of the landsat archive
var start = ee.Image(ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').first()).date().format();
var now = Date.now();
var end = ee.Date(now).format();
var date_range = ee.DateRange(start, end);

// Asynchronously compute the date range and show the slider.
var dateSlider = ui.DateSlider({
    start: date_range.start(),
    end: date_range.end(),
    value: date_range.start(),
    period: 365,
    style: {width: '350px'}
  });

zoomButton.onClick(function(){
  // Clean-up the map and panel displays when new information is requested
  Map.clear();
  panel.widgets().reset(button_widgets);

  // Evaluation of the date range provided through the drop-down menu options
  ee.Dictionary({
    start: dateSlider.getValue()[0],
    end: dateSlider.getEnd()
    }).evaluate(applyFilter);
}); 



/***********************************************************************************************************/
/********************* UI - callback function to return maps charts based on user input********************/
/*********************************************************************************************************/
/**
 * Main app callback.
 * Reads the selected project, builds restoration/control areas,
 * extracts project dates, and updates map layers and charts
 * according to the selected indicator.
 */
function applyFilter(){
  

  // Assign the widget values to variables
  var adm1_name = statesDD.getValue();
  var adm0_name = CountryDD.getValue();
  
  // Filter merged_data to get the feature(s) with the selected ProjectID
  var ProjectBoundary = ee.FeatureCollection(PROJECTS).filter(ee.Filter.eq('ProjectID', adm0_name));
  var selectedFeature = ProjectBoundary.first();
  var restorationGeometry = selectedFeature.geometry();
  var restorationRegion = ee.FeatureCollection([
  ee.Feature(restorationGeometry, {PROJECT: 'Restoration area'})
]);


  
  var aoi_layer = ui.Map.Layer(restorationGeometry, {}, adm0_name + ' Project ID Boundary');
  // Center the map on the selected region
  Map.centerObject(restorationGeometry);
  Map.setOptions('SATELLITE')
  
  // Clear existing layers and add the selected region as a new layer
  Map.layers().reset([]);
  
  
  
  // Create a first control area as a 2 km ring around the restoration geometry.
  var control_area1 =  ee.FeatureCollection(restorationGeometry.buffer(2000).difference(restorationGeometry,10))
  var dissolve = function(featureCollection) {
  var mergedGeometry = featureCollection.geometry().dissolve(1);
  return ee.FeatureCollection([ee.Feature(mergedGeometry)]);
  };


  
  var control1_geo =control_area1.geometry()
  //var controlareas_geo =control_areas.geometry()
  
  
  
  // Create an empty image into which to paint the features, cast to byte.
  var empty = ee.Image().byte();
  
  // Paint all the polygon edges with the same number and width, display.
  var outline_control1 = empty.paint({
    featureCollection: control_area1,
    color: 1,
    width: 3
  });

  
  var outline_rest = empty.paint({
    featureCollection: restorationGeometry,
    color: 1,
    width: 3
  });

  
  
  // ***************************************** optional Adding one more control area using drawing tool **********************//  

   // Initialize optional user-drawn control area tools.
  // NOTE: This feature is experimental and not fully implemented.
  // Currently, user-drawn geometries are not used in the final analysis workflow.
  // Add the drawing tools and control panel to the map
  var drawing_elements = drawingTools.initializeDrawingTools();
  var drawing_tools = drawing_elements[0];
  var control_panel = drawing_elements[1];
  
  //var control_area3 = drawing_tools.layers().get(0).getEeObject();
 
  //print(control_area3)
  var control_area_lr1 = ui.Map.Layer(control1_geo, {color: 'FF0000'}, ' Control area - 1');

  
  var restoration_arealyr = ui.Map.Layer(restorationGeometry, {color: '6BFF33'}, adm0_name + ' Boundaries');

  Map.add(restoration_arealyr);
  Map.add(control_area_lr1)
  Map.add(control_panel);
  
  
  // Logic to capture the drawn geometry
  //drawing_tools.onDraw(function() {});
  var drawnGeom = drawing_tools.layers().get(0).getEeObject();
  //Map.addLayer(drawnGeom, {color: 'yellow'}, 'Drawn Area');
  var drawnFeature = ee.Feature(drawnGeom);
 
  
  /**************************************************************************************************/
  
  /**************************Filter Project Name, Start Date and End Date ***************************/
  
  /**************************************************************************************************/
  
 
  // Extract intervention start/end dates and project name from the selected feature
  var filterEndDate = ProjectBoundary.map(function(feature) {
    // Check for the existence of both 'Project_En' and 'Project En'
    var projectEn = feature.get('Project_En');
    var projectEnAlt = feature.get('Project En');
    var dateOfEn = projectEn ? projectEn : projectEnAlt;
  
  return ee.Feature(null, {'Date_of_En': dateOfEn});
  });
 
  
  var filterStartDate = ProjectBoundary.map(function(feature) {
    var projectSt = feature.get('Project_St');
    var projectEStlt = feature.get('Project St');
    var dateOfSt = projectSt ? projectSt : projectEStlt;
  
    return ee.Feature(null, {'Date_of_St': dateOfSt});
  });

  var filterProjectDetails = ProjectBoundary.map(function(feature) {
    return ee.Feature(null, {'Project_name': feature.get('Project_Na')|| feature.get('Project Na')});
  });

    // Aggregate project names into an array
  var projectNames = filterProjectDetails.aggregate_array('Project_name');
  
  // Print the array of project names to the console
  //print('Project Names:', projectNames);

  // Extract the start and end dates
  var startDates = extractDates(filterStartDate, 'Date_of_St');
  var endDates = extractDates(filterEndDate, 'Date_of_En');
  
  //print('Start dates -->>>:', startDates);
  //print('End dates:---->>>', endDates);
  
  // Evaluate startDates and endDates to get lists and perform further operations
  startDates.evaluate(function(startDatesList) {
    endDates.evaluate(function(endDatesList) {
      
    var startDatesList_ = startDatesList.map(convertToDateFormat);
    var endDatesList_ = endDatesList.map(convertToDateFormat);
    //print('Start dates:', startDatesList_);
    //print('End dates:', endDatesList_);
   
    var project_end =ee.Date(endDatesList_[0])
    var project_start = ee.Date(startDatesList_[0])
    var year = project_start.get('year');
    // Calculate the date 3 years before the start date
    var monitoring_start = project_start.advance(-3, 'year').format('YYYY-MM-dd');


/* --------------------------- CONTROL AREAS ------------------------------- */
  // Build a second control area by searching for a nearby polygon of similar size
  // and broadly comparable land-cover composition.
  function createRandomPolygon(referenceFeature, maxAttempts) {
    
    // Compare restoration and candidate polygons using land-cover composition
    // to avoid selecting a random control with very different surface characteristics.
    
    // Get the geometry of the reference polygon
    var referenceGeometry = referenceFeature.geometry();
    var referenceArea = referenceGeometry.area()
    
    
    // Check if it's a GeometryCollection and extract the first Polygon if so
    var firstPartGeometry;
    if (referenceGeometry.type() === 'GeometryCollection') {
      // Extract the first polygon from the collection
      var geometries = referenceGeometry.geometries();  // Get the individual geometries
      firstPartGeometry = ee.Geometry(geometries.get(0));  // Assume the first geometry is the one you need
    } else {
      // Otherwise, it's a single geometry, so use it directly
      firstPartGeometry = ee.Geometry(referenceGeometry);
    }
    
    //print('referenceArea -->',referenceArea)
    var control_areaA = control1_geo.area()
    //print('control_areaA -->',control_areaA);
    // Calculate buffer distance based on the area (e.g., proportional to the square root of the area)
    var bufferDistance = referenceArea.sqrt().multiply(2); // Dynamic buffer distance
    
    bufferDistance = bufferDistance;
    //print('Buffer Distance (meters):', bufferDistance);
    
    // Define the start and end date for the specific year (from January to December)
    var sDate = ee.Date.fromYMD(year, 1, 1);   // January 1st of the selected year
    var eDate = ee.Date.fromYMD(year, 12, 31);   // December 31st of the selected year
    // Load a land cover dataset (MODIS Land Cover in this example)
    var landCover = ee.ImageCollection('MODIS/006/MCD12Q1')
                    .filterDate(sDate,eDate)
                    .first().select('LC_Type1').clip(referenceGeometry);
     
      // Extract the unique land cover values
    var uniqueLandCover1 = landCover.reduceRegion({
        reducer: ee.Reducer.frequencyHistogram(), // Count the occurrence of each land cover type
        geometry: referenceGeometry, // The geometry to summarize over
        scale: 100, // Specify the scale in meters (depends on your analysis needs)
        maxPixels: 1e9 // Limit the number of pixels processed
      });
      
      // Get the land cover classes from the histogram result
    var landCoverClasses1 = ee.Dictionary(uniqueLandCover1.get('LC_Type1')).keys(); // Extract the unique keys (land cover classes)

      // Convert the land cover classes to a list
    var landCoverTypes1 = landCoverClasses1.map(function (number) { return ee.Number.parse(number) }); // Convert keys to numbers
      // Print the unique land cover values
    //print('Unique Land Cover Types restoration:', landCoverTypes1);
   
   
    // Create a buffer around the reference polygon
    var buffer = firstPartGeometry.buffer(bufferDistance);
    
    // Subtract the reference polygon from the buffer to exclude it
    var bufferWithoutPolygon = buffer.difference(referenceGeometry, ee.ErrorMargin(1)).difference(control_area1,ee.ErrorMargin(1));
    
    // Debug: Visualize the buffer area
    //Map.addLayer(bufferWithoutPolygon, {color: 'green'}, 'Buffer without Reference Polygon');
    //print('Buffer Area (sq meters):', bufferWithoutPolygon.area());
    
    // Define the bounds of the bufferWithoutPolygon
    var bounds = bufferWithoutPolygon.bounds().coordinates().get(0);
    var boundsList = ee.List(bounds);
    
    // Find the min and max coordinates (bounding box)
    var minX = ee.Number(ee.List(boundsList.get(0)).get(0));
    var minY = ee.Number(ee.List(boundsList.get(0)).get(1));
    var maxX = ee.Number(ee.List(boundsList.get(2)).get(0));
    var maxY = ee.Number(ee.List(ee.List(boundsList.get(2)).get(1))); // Fixed index for Y
    
    // Function to generate a random point within the bounds
    function generateRandomPoint() {
      var xRandom = minX.add(ee.Number(Math.random()).multiply(maxX.subtract(minX)));
      var yRandom = minY.add(ee.Number(Math.random()).multiply(maxY.subtract(minY)));
      return ee.Geometry.Point([xRandom, yRandom]);
    }
    
    // Try generating a random polygon with the same area as the reference polygon
    var attempt = 0;
    var randomPolygon = null;
    
    // Accept the candidate only if it does not overlap the restoration area
   // or the buffer control and meets similarity thresholds.
    
    while (attempt < maxAttempts) {
      attempt += 1;
      
      // Generate a random point
      var randomPoint = generateRandomPoint();
      
      // Calculate the radius needed to match the reference polygon area
      var targetRadius = ee.Number(referenceArea.divide(Math.PI).sqrt()); // Use ee.Number directly
      targetRadius=targetRadius
      //print('Attempt:', attempt, 'Target Radius (meters):', targetRadius);
      
      // Create a polygon with the calculated radius around the random point
      var candidatePolygon = randomPoint.buffer(targetRadius); // Use the target radius
      
      // Ensure the polygon does not overlap with the reference polygon
      var overlap = candidatePolygon.intersects(referenceGeometry, ee.ErrorMargin(1));
      
      //ensure doesnt overlap with other control areas
      var overlap2 = candidatePolygon.intersects(control1_geo, ee.ErrorMargin(1));
      
      var distanceToReference = candidatePolygon.distance(referenceGeometry);

          // Get the land cover type of the candidate polygon
      var land_cover2 = ee.ImageCollection('MODIS/006/MCD12Q1')
                    .filterDate(sDate,eDate)
                    .first().select('LC_Type1').clip(candidatePolygon);
      //print('Land cover 2',land_cover2)
      //print('land cover',landCover)
      // Extract the unique land cover values
      var uniqueLandCover = land_cover2.reduceRegion({
        reducer: ee.Reducer.frequencyHistogram(), // Count the occurrence of each land cover type
        geometry: candidatePolygon, // The geometry to summarize over
        scale: 10, // Specify the scale in meters (depends on your analysis needs)
        maxPixels: 1e9 // Limit the number of pixels processed
      });
      
      // Get the land cover classes from the histogram result
      var landCoverClasses = ee.Dictionary(uniqueLandCover.get('LC_Type1')).keys(); // Extract the unique keys (land cover classes)

      // Convert the land cover classes to a list
      var landCoverTypes = landCoverClasses.map(function (number) { return ee.Number.parse(number) }); // Convert keys to numbers
      // Print the unique land cover values
      //print('Unique Land Cover Types candidate polygon:', uniqueLandCover);
     
      // Define a threshold for leniency (e.g., 70%)
      var matchThreshold = 0.7;  // 70% match
      
      // Check if all land cover types in the candidate polygon are contained in the global list
      var commonClasses  = landCoverTypes.map(function(landCoverClass) {
        return landCoverTypes1.contains(landCoverClass);
      });
      //print('commonClasses ',commonClasses )
      // Calculate the percentage of matching classes
      var percentageMatch = commonClasses.length().divide(landCoverTypes.length());
      // Check if all elements in the result list are `true` (i.e., all classes are contained)
      // Check if the percentage of matching classes meets the threshold
      var landCoverMatch = ee.Algorithms.If(
        percentageMatch.gte(matchThreshold),  // If the match percentage is >= threshold
        true,  // Consider it valid
        false  // Otherwise, consider it invalid
      );
      /*
      var referenceLandCoverProportion = ee.Dictionary(uniqueLandCover1.get('LC_Type1')).values();
      var randomLandCoverProportion = ee.Dictionary(uniqueLandCover.get('LC_Type1')).values();
      // Compare proportions within a certain tolerance (e.g., 10%)
      var proportionMatch = referenceLandCoverProportion.zip(randomLandCoverProportion)
                             .map(function(pair) {
                                 var referenceProportion = ee.Number(ee.List(pair).get(0));
                                 var randomProportion = ee.Number(ee.List(pair).get(1));
                                 return referenceProportion.subtract(randomProportion).abs().lte(0.2);  // 10% tolerance
                             });
      print('proportionMatch',proportionMatch)
      
      // Check if all proportions match within the tolerance
      var allProportionsMatch = ee.List(proportionMatch).reduce(ee.Reducer.min()); // Returns 1 if all match, else 0
        */
        
      // Calculate the proportion of each land cover class
      function calculateClassPercentage(landCoverImage, roi) {
        var totalPixels = landCoverImage.reduceRegion({
          reducer: ee.Reducer.count(),
          geometry: roi,
          scale: 100,
          maxPixels: 1e9
        }).get('LC_Type1');
        
        var classCounts = landCoverImage.reduceRegion({
          reducer: ee.Reducer.frequencyHistogram(),
          geometry: roi,
          scale: 100,
          maxPixels: 1e9
        }).get('LC_Type1');
        
        var percentages = ee.Dictionary(classCounts).map(function(key, value) {
          return ee.Number(value).divide(ee.Number(totalPixels));
        });
        
        return percentages;
      }
      
      // Get percentages for restoration and control areas
      var restorationPercentages = calculateClassPercentage(landCover, referenceGeometry);
      var controlPercentages = calculateClassPercentage(land_cover2, candidatePolygon);
      

      ///////******************SR score ***********************//////////////
      
      // Function to calculate SR (Similarity Ratio) for matching land cover classes
      function calculateSR(proportions1, proportions2) {
        // Get the common keys (classes) from both dictionaries
        proportions1 = ee.Dictionary(proportions1);
        proportions2 = ee.Dictionary(proportions2);
      
        // Get all unique keys (union of keys in both dictionaries)
        var allKeys = proportions1.keys().cat(proportions2.keys()).distinct();
      
        // Compute SR for all keys
        var srResults = ee.Dictionary.fromLists(
          allKeys,
          allKeys.map(function(key) {
            var proportion1 = ee.Number(proportions1.get(key, 0)); // Default to 0 if missing
            var proportion2 = ee.Number(proportions2.get(key, 0)); // Default to 0 if missing
      
            // Avoid division by zero
            return ee.Algorithms.If(proportion2.gt(0), proportion1.divide(proportion2), null);
          })
        );

      
        return srResults;
      }
      
      // Calculate SR for each matching class
      var srResults = calculateSR(restorationPercentages, controlPercentages);
      
      // Print SR values for each class
      //print('Similarity Ratios (SR) for matching land cover classes:', srResults);


      ///////////////////************************************/////////////////////
      var distMatch = ee.Algorithms.If(
        distanceToReference.lte(4000),  // Server-side comparison for distance <= 4000 meters
        true,  // If the distance is <= 4000 meters
        false  // If the distance is > 4000 meters
    );
      // Print the result to check
      //print('Do the classes match leniently?:', landCoverMatch);
      //print('Is the distance less than 4km?:', distMatch );

      
      // Ensure the candidate polygon is within the bufferWithoutPolygon
      //var withinBuffer = candidatePolygon.intersects(bufferWithoutPolygon, ee.ErrorMargin(1));
      
      // Debugging outputs
      //print('Candidate Polygon Area (sq meters):', candidatePolygon.area());
      //print('Overlaps with Reference:', overlap.getInfo());
      //print('overlaps with Buffer:', overlap2.getInfo());
      //print('Distance to Reference (meters):', distanceToReference.getInfo())
      
      // Calculate dot product of referenceProportions and candidateProportions (cosine similarity)
      var dotProduct = restorationPercentages.keys().map(function(key) {
          var refValue = ee.Number(restorationPercentages.get(key, 0)); // Default to 0 if key is missing
          var candValue = ee.Number(controlPercentages.get(key, 0)); // Default to 0 if key is missing
          return refValue.multiply(candValue);
      }).reduce(ee.Reducer.sum());

      
      // Calculate the norm of the restoration percentages vector
      var referenceNorm = ee.Number(
          ee.List(restorationPercentages.values()).map(function(value) {
              return ee.Number(value).pow(2);
          }).reduce(ee.Reducer.sum())
      ).sqrt(); // Apply sqrt to the ee.Number result
      
      // Calculate the norm of the control percentages vector
      var candidateNorm = ee.Number(
          ee.List(controlPercentages.values()).map(function(value) {
              return ee.Number(value).pow(2);
          }).reduce(ee.Reducer.sum())
      ).sqrt(); // Apply sqrt to the ee.Number result
      
      var cosineSimilarity = ee.Number(dotProduct).divide(referenceNorm.multiply(candidateNorm));
      //print('cosineSimilarity',cosineSimilarity)
      var isValid = cosineSimilarity.gte(0.7); // Threshold for similarity (e.g., 90%)
      
      var srThresholdLower = 0.8;
      var srThresholdUpper = 1.2;

      var keys = srResults.keys(); // Land cover classes
      var values = srResults.values(); // SR values
      
      var withinThreshold = values.map(function(srValue) {
      // Explicitly check for null and handle it
      srValue = ee.Algorithms.If(ee.Algorithms.IsEqual(srValue, null), ee.Number(0), ee.Number(srValue));
          return ee.Number(srValue).gte(srThresholdLower).and(ee.Number(srValue).lte(srThresholdUpper));
          });
    
      // Determine if all SR values are within the threshold
      var allWithinThreshold = ee.List(withinThreshold).reduce(ee.Reducer.min());
        
      
      allWithinThreshold = withinThreshold;
      //print('All SR values within threshold?', allWithinThreshold);
      
      // Count the number of SR values within the threshold
      var withinThresholdCount = ee.List(withinThreshold).filter(ee.Filter.equals('item',1)).length();
      
      // Determine how many SR values meet the condition (e.g., 50% of the total values)
      var requiredThreshold = ee.Number(values.length()).multiply(0.25); // 50% of the total SR values
      
      // Check if the number of SR values within threshold is greater than or equal to the required threshold
      var isValidThresh = withinThresholdCount.gte(requiredThreshold);
      //print('Number of SR values within threshold:', withinThresholdCount);
      //print('Required threshold (50%):', requiredThreshold);

      // If no overlap and within buffer area, return the polygon
      //if (!overlap.getInfo() && isValid.getInfo()  && isValidThresh.getInfo()  && landCoverMatch.getInfo() && allWithinThreshold.getInfo() && !overlap2.getInfo()){
      if (!overlap.getInfo() && isValid.getInfo()  && isValidThresh.getInfo()  && landCoverMatch.getInfo() && !overlap2.getInfo()){
      //if (!overlap.getInfo() && !overlap2.getInfo()){
        randomPolygon = candidatePolygon;
        break;
      }
    }
   

    
    // Return the random polygon or null if max attempts reached
    if (randomPolygon) {
      print('Random Polygon Area (sq meters):', randomPolygon.area());
    } else {
      print('No valid polygon found after', maxAttempts, 'attempts.');
    }
    
    return randomPolygon;
  }

  // Apply the function to each feature in the collection
  // Call the function with a limit of 20 attempts
  var control_area2 = createRandomPolygon(ee.Feature(restorationGeometry), 20);
    

 
  var mergedControlAreas = control_area1.merge(control_area2);
  var control_areas_ = mergedControlAreas.union(ee.ErrorMargin(1));//ee.FeatureCollection(dissolve(mergedControlAreas)).geometry();

  /*
  Export.table.toDrive({
  collection: control_areas_,
  description:'control_area_Ghana',
  fileFormat: 'SHP'});
  
  Export.table.toDrive({
  collection: selectedFeature,
  description:'restoration_area_Ghana',
  fileFormat: 'SHP'}); */

  var control_area_lr2 = ui.Map.Layer(control_area2,{color: 'f58c75'},'Control area 2 ');
  var control_areas_lr = ui.Map.Layer(control_areas_, {color: 'FF0000'}, ' Control area 1 + Control area 2');
  Map.add(control_area_lr2)
  
  /******************************* UI- DISPLAY PROJECT DETAILS *****************************************************/
    // Convert server-side array to client-side
  projectNames.evaluate(function(names) {
      projectdetailP.add(ui.Label('The selected project is called: '+names[0]+' which started on ' + startDatesList_[0].getInfo()+' and ends on '+endDatesList_[0].getInfo(),{fontSize: '14px'}));
      //panel.widgets(6).add(projectdetailP)
    
    });
  
  plotsDD.items().reset(['Normalized Difference Vegetation Index', 'Land Surface Temperature', 'Normalized Difference Water Index'
    ]);
    
  plotsDD.setPlaceholder('Choose Resilence Indicator');
  
  //Map.add(restoration_arealyr);
  //Map.add(control_area_lr1)
  //Map.add(control_area_lr2)
  //Map.add(control_areas_lr)
  
  
//*****************************************************************************************************//
//****************************Resilience indictors******************************************************************************************//
//********************************************************************************************************//  
    
    //populate app with infomation based on selected indicator
  plotsDD.onChange(function(selectedPlot) {
      //print('Plot selected:', selectedPlot);  // Debugging statement
      Map.clear();
      Map.add(restoration_arealyr);
      Map.add(control_area_lr1)
      Map.add(control_area_lr2)
      Map.add(control_areas_lr)
      var chartPanel = ui.Panel();
      panel.widgets().add(chartPanel)

      var applyWaterMask1 = function(image) {
        return applyNonWaterMask(image, control_areas_);
      };
      
      var applyWaterMask2 = function(image) {
        return applyNonWaterMask(image, restorationGeometry);
      };
        
      if (selectedPlot === 'Normalized Difference Vegetation Index') {
       
        // NDVI branch:
        // 1. load restoration and control collections
        // 2. compute DiD coefficient
        // 3. build monthly means
        // 4. derive restoration-control difference series
        // 5. accumulate differences through time
        // 6. render map layers and charts               
        var metric = METRICS['NDVI']
        var restorationTs =loadMetricCollection('NDVI', restorationGeometry, monitoring_start, project_end);
        var controlTs = loadMetricCollection('NDVI', control_areas_, monitoring_start, project_end);
        
        
        var didCoefficient = computeDidForMetric('NDVI', restorationGeometry, control_areas_, monitoring_start, project_start, project_end);
      
        panelndviDID.add(ui.Label({
          value: 'Difference-in-Differences Coefficient',
          style: { fontWeight: 'bold', fontSize: '16px' }
        }));
        // Evaluate the DiD coefficient
        didCoefficient.evaluate(function(didValue){ 
          // Add the evaluated value to the panel
          panelndviDID.add(ui.Label('NDVI :' + didValue.toFixed(4)));
          //print('Difference-in-Differences Coefficient for NDVI: ', didValue);
        });

        var NDVI_layer1 = ui.Map.Layer(controlTs.first(),METRICS.NDVI.viz,'MODIS NDVI restoration area' );
                    
        var NDVI_layer2 = ui.Map.Layer(restorationTs.first(),METRICS.NDVI.viz,'MODIS NDVI control area');
        
       
        //Calculate monthly average NDVI
        var restorationTsMeanCollection = calcMonthlyMean(restorationTs);
        var controlTsMeanCollection = calcMonthlyMean(controlTs);
  
      
        restorationTsMeanCollection =restorationTsMeanCollection.toList(restorationTsMeanCollection.size())
        controlTsMeanCollection =controlTsMeanCollection.toList(controlTsMeanCollection.size())
        
        restorationTsMeanCollection = comprobeBandsNumber(restorationTsMeanCollection);
        controlTsMeanCollection = comprobeBandsNumber(controlTsMeanCollection);
        
        restorationTsMeanCollection = restorationTsMeanCollection.removeAll([0])
        controlTsMeanCollection = controlTsMeanCollection.removeAll([0])
        
        // Assuming 'referenceMeanCollection' and 'seriesMeanCollection' are ee.List objects convert to image collection
        restorationTsMeanCollection = ee.ImageCollection.fromImages(restorationTsMeanCollection);
        controlTsMeanCollection = ee.ImageCollection.fromImages(controlTsMeanCollection);
  
        // NDVI difference
        
        var NDVI_DIFF = restorationTsMeanCollection.map(function(img){
            
            // Get the timestamp property and convert it to a Date object
          var timeStart = ee.Date(img.get('system:time_start'));
              
               // Extract the month and day
          var month = timeStart.get('month');  
          var year = timeStart.get('year');

          // Select image in the reference period
          var filteredcontrolTs = controlTsMeanCollection
                                .filter(ee.Filter.calendarRange(month, month, "month"));
          // Use a fallback image if the reference collection is empty
          var controlTsMaps = ee.Algorithms.If(
              filteredcontrolTs.size().gt(0),    // Condition: check if collection is not empty
              filteredcontrolTs.first(),  // If true: Use the first image
              ee.Image.constant(0)               // If false: Use a fallback constant image
          );    
              //referenceMaps = ee.Algorithms.If(referenceMaps, ee.Image(referenceMaps), ee.Image(0));
          restorationTs = img
              
          var result = ee.Image(restorationTs.subtract(controlTsMaps).set('system:time_start',timeStart));
              
          return result
            
          });


        
        //get the timestamp from the most recent image in the refrence collection
        var time0 = NDVI_DIFF.first().get('system:time_start');
        
        //the first anomaly in the list is just 0
        
        var first =  ee.List([ee.Image(0).set('system:time_start', time0).select([0],['NDVI'])]);
        
        var cumulative = ee.ImageCollection(ee.List(NDVI_DIFF.iterate(accumulate,first)))
        
        
       
      
        
        
        var comb = controlTsMeanCollection.combine(restorationTsMeanCollection)
       
         // Define the regions, including restoration and control areas
        var regions = ee.FeatureCollection(ProjectBoundary.merge(control_areas_));
        
        var plotNDVI = createSeriesByRegionChart(comb,regions,'NDVI',500,'Average NDVI Time-series Analysis ','Average NDVI');
         //NDVI Diff
        
        var NDVI_Diff_Chart = createDiffChart(NDVI_DIFF,restorationGeometry,500,'NDVI Difference (Restoration area - Control area)','NDVI Difference', 'PROJECT');
         
        // Cumulative NDVI Difference chart
        
        var Cumulative_NDVI_Diff_Chart = createCumulativeDiffChart(cumulative,restorationGeometry,500,
            'Cumulative NDVI Difference(restoration area - control area)',
            'Cumulative NDVI difference',
            'PROJECT'
          );
     
        
        Map.add(legend);
        Map.add(NDVI_layer1)
        Map.add(NDVI_layer2)
          

        chartPanel.clear()
        chartPanel.add(chartdetailPanelndvi)
        chartPanel.add(chartdetailndvi1)
        chartPanel.add(chartdetailndvi2)
         

        chartPanel.add(plotNDVI)
        chartPanel.add(chartdetailPanelndviDiff)
          
        chartPanel.add(NDVI_Diff_Chart);
        chartPanel.add(chartdetailPanelndviCumDiff);
        chartPanel.add(Cumulative_NDVI_Diff_Chart);
                                               
                                                
    } else if(selectedPlot === 'Land Surface Temperature'){
      
      // LST branch:
      // Uses scaled MODIS LST (Kelvin) to compare restoration and control thermal dynamics.
      // Difference images must be centered near zero before cumulative sums are interpreted.

      var restorationTs =loadMetricCollection('LST', restorationGeometry, monitoring_start, project_end);
      var controlTs = loadMetricCollection('LST', control_areas_, monitoring_start, project_end);
        
        
      var didCoefficient = computeDidForMetric('LST', restorationGeometry, control_areas_, monitoring_start, project_start, project_end);
     
      // Evaluate the DiD coefficient
      didCoefficient.evaluate(function(didValue) {
        // Add the evaluated value to the panel
        panelndviDID.add(ui.Label('LST :'+didValue.toFixed(4)));
        //print('Difference-in-Differences Coefficient for LST: ', didValue);
      });
      
      //display LST maps                                    
      var LST_layer1 = ui.Map.Layer(restorationTs.first(),
                                       METRICS.LST.viz,
                                       'MODIS LST restoration area'
                                       );
      var LST_layer2 = ui.Map.Layer(controlTs.first(),
                                       METRICS.LST.viz,
                                       'MODIS LST control area'
                                       );
                                       
      
   
   
      //Calculate monthly average LST
      var restorationTsMeanCollection = calcMonthlyMean(restorationTs);
      var controlTsMeanCollection = calcMonthlyMean(controlTs);
      
      restorationTsMeanCollection =restorationTsMeanCollection.toList(restorationTsMeanCollection.size())
      controlTsMeanCollection = controlTsMeanCollection.toList(controlTsMeanCollection.size())
        
      restorationTsMeanCollection = comprobeBandsNumber(restorationTsMeanCollection)
      controlTsMeanCollection = comprobeBandsNumber(controlTsMeanCollection)
        
      restorationTsMeanCollection = restorationTsMeanCollection.removeAll([0])
      controlTsMeanCollection = controlTsMeanCollection.removeAll([0])
        
        // Assuming 'referenceMeanCollection' and 'seriesMeanCollection' are ee.List objects
      restorationTsMeanCollection = ee.ImageCollection.fromImages(restorationTsMeanCollection);
      controlTsMeanCollection = ee.ImageCollection.fromImages(controlTsMeanCollection);

      
      
      var LST_DIFF = restorationTsMeanCollection.map(function(img){
          
          // Get the timestamp property and convert it to a Date object
          var timeStart = ee.Date(img.get('system:time_start'));
          
           // Extract the month and day
          var month = ee.Number.parse(timeStart.format('M'));
       
          //select image in reference period
          
          var controlTsMaps = controlTsMeanCollection.filter(ee.Filter.calendarRange(month,month,"month")).first()
          
          var result = ee.Image(img.subtract(controlTsMaps).set('system:time_start',timeStart));
          
          return result
          
        });
        
        
      //get the timestamp from the most recent image in the refrence collection
      var timelst = LST_DIFF.first().get('system:time_start');
        
      //the first anomaly in the list is just 0
        
      var firstlst =  ee.List([ee.Image(0).set('system:time_start', timelst).select([0],['LST_Day_1km'])]);
        
      var cumulativeLST = ee.ImageCollection(ee.List(LST_DIFF.iterate(accumulate,firstlst)))
      print(cumulativeLST,'cumulativeLST')
      var comblst = controlTsMeanCollection.combine(restorationTsMeanCollection)
         // Define the regions, including restoration and control areas
      var regions = ee.FeatureCollection(ProjectBoundary.merge(control_areas_));
        
      var plotLST =  createSeriesByRegionChart(comblst,regions,'LST_Day_1km',500,
          'Average LST Time-series Analysis ',
          'Average LST'
        );

      //LST diff chart
      var LST_Diff_Chart = createDiffChart(LST_DIFF,restorationRegion,500,'LST(K) Difference (Restoration area - Control area)',
          'LST Difference',
          'PROJECT'
        );
         
      // Cumulative NDVI Difference chart
          
      var Cumulative_LST_Diff_Chart = createCumulativeDiffChart(cumulativeLST,restorationRegion,500,
          'Cumulative LST Difference(restoration area - control area)',
          'Cumulative LST difference',
          'PROJECT'
        );
      
      Map.add(LST_layer1)
      Map.add(LST_layer2)
      Map.add(legend);

      chartPanel.clear();
      chartPanel.add(chartdetailPanelst);
      chartPanel.add(chartdetaillst1)
      chartPanel.add(chartdetaillst2)
      chartPanel.add(plotLST);
          
      chartPanel.add(chartdetailPanellstDiff);
      chartPanel.add(LST_Diff_Chart);
      chartPanel.add(chartdetailPanellstCumDiff);
      chartPanel.add(Cumulative_LST_Diff_Chart);
          
         
    
    } else if(selectedPlot === 'Normalized Difference Water Index'){

 

      // NDWI branch:
      // NDWI is derived from MODIS surface reflectance and used to compare water-related
      // vegetation/moisture differences between restoration and control areas.
      var restorationTs = loadMetricCollection('NDWI', restorationGeometry, monitoring_start, project_end);
      var controlTs = loadMetricCollection('NDWI', control_areas_, monitoring_start, project_end);
      
      var didCoefficient = computeDidForMetric('NDWI',restorationGeometry,control_areas_,monitoring_start,project_start,
        project_end
      );
    
      // Evaluate the DiD coefficient
      didCoefficient.evaluate(function(didValue) {
        // Add the evaluated value to the panel
        panelndviDID.add(ui.Label('NDWI :'+ didValue.toFixed(4)));
        
      });
      
      
      //display NDWI maps                                    
      var NDWI_layer1 = ui.Map.Layer(restorationTs.median(),
                                       METRICS.NDWI.viz,
                                       'MODIS NDWI restoration area'
                                       );
      var NDWI_layer2 = ui.Map.Layer(controlTs.median(),
                                       METRICS.NDWI.viz,
                                       'MODIS NDWI control area'
                                       );
                                       
      //Calculate monthly average NDVI
      var restorationTsMeanCollection = calcMonthlyMean(restorationTs);
      var controlTsMeanCollection = calcMonthlyMean(controlTs);
      
      restorationTsMeanCollection =restorationTsMeanCollection.toList(restorationTsMeanCollection.size())
      controlTsMeanCollection = controlTsMeanCollection.toList(controlTsMeanCollection.size())
        
      restorationTsMeanCollection = comprobeBandsNumber(restorationTsMeanCollection)
      controlTsMeanCollection = comprobeBandsNumber(controlTsMeanCollection)
        
      restorationTsMeanCollection = restorationTsMeanCollection.removeAll([0])
      controlTsMeanCollection = controlTsMeanCollection.removeAll([0])
        
        // Assuming 'referenceMeanCollection' and 'seriesMeanCollection' are ee.List objects
      restorationTsMeanCollection = ee.ImageCollection.fromImages(restorationTsMeanCollection);
      controlTsMeanCollection = ee.ImageCollection.fromImages(controlTsMeanCollection);
        
      
      var NDWI_DIFF = restorationTsMeanCollection.map(function(img){
          
          // Get the timestamp property and convert it to a Date object
          var timeStart = ee.Date(img.get('system:time_start'));
          
           // Extract the month and day
          var month = ee.Number.parse(timeStart.format('M'));
       
          
          //select image in reference period
          
          var controlTsMaps = controlTsMeanCollection.filter(ee.Filter.calendarRange(month,month,"month")).first()
          
          var result = ee.Image(img.subtract(controlTsMaps).set('system:time_start',timeStart));
          
          return result
          
        });
        
        
      //get the timestamp from the most recent image in the refrence collection
      var timeNDWI = NDWI_DIFF.first().get('system:time_start');
        
      //the first anomaly in the list is just 0
        
      var firstNDWI =  ee.List([ee.Image(0).set('system:time_start', timeNDWI).select([0],['NDWI'])]);
        
      var cumulativeNDWI = ee.ImageCollection(ee.List(NDWI_DIFF.iterate(accumulate,firstNDWI)))

      var combNDWI = restorationTsMeanCollection.combine(controlTsMeanCollection)
      // Define the regions, including restoration and control areas
      var regions = ee.FeatureCollection(ProjectBoundary.merge(control_areas_));
        
      var plotNDWI = createSeriesByRegionChart(combNDWI,regions,'NDWI',500,'Average NDWI Time-series Analysis ','Average NDWI');

      //NDWI diff chart
      var NDWI_Diff_Chart =createDiffChart( NDWI_DIFF,restorationGeometry,500,'NDWI Difference (Restoration area - Control area)',
          'NDWI Difference',
          'PROJECT'
        );

      // Cumulative NDWI Difference chart
      var Cumulative_NDWI_Diff_Chart = createCumulativeDiffChart(cumulativeNDWI,restorationGeometry,500,'Cumulative NDWI Difference(restoration area - control area)',
          'Cumulative NDWI difference',
          'PROJECT'
        );
      Map.add(NDWI_layer1)
      Map.add(NDWI_layer2)

      chartPanel.clear()
      chartPanel.add(chartdetailPanelndwi)
      chartPanel.add(chartdetailndwi1)
      chartPanel.add(chartdetailndwi2)
      chartPanel.add(plotNDWI)
      Map.add(legend);

      chartPanel.add(chartdetailPanelndwiDiff);
      chartPanel.add(NDWI_Diff_Chart);
      chartPanel.add(chartdetailPanelndwiCumDiff);
      chartPanel.add(Cumulative_NDWI_Diff_Chart);
          

    
    }});     
  
  });
});



}
      

/***************************************** PANEL DESIGN *********************************************************************************************/

//mapPanel.add(logo);      
var button_widgets = [logo,header, text, con1,con2,con3,ControlAreaPanel,demolabel,demodescription,referenceOne,statesDD, CountryDD, zoomButton,projectdetailP,indicatorSelectionPanel, plotsDD,panelndviDID] ;
//button_widgets.unshift(logo);
// Combine all widgets into the side-panel
var panel = ui.Panel({widgets: button_widgets,
  layout: ui.Panel.Layout.flow('vertical'),
  style: { width: '25%' }
});
ui.root.insert(0,panel);

// Create a horizontal panel to organize the left, center (map), and right panels
var mainPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),  // Horizontal layout
  style: {stretch: 'both'}  // Make it take up the full space
});




