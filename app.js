const GRAV_CONSTANT = 9.81;
const WATER_DENSITY = 998;
const AIR_DENSITY = 1.204;

var totalMass = 0;
var totalMassDisplaced = 0;

var CG = [[0], [0], [0]];
var CB = [[0], [0], [0]];

var topLevel = null;
var partsToEval = [];
var partIds = [];

function multiplyMatrices(m1, m2) {
  var result = [];
  for (var i = 0; i < m1.length; i++) {
    result[i] = [];
    for (var j = 0; j < m2[0].length; j++) {
      var sum = 0;
      for (var k = 0; k < m1[0].length; k++) {
        sum += m1[i][k] * m2[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function transformVector(matrices, vector) {
  for (var A = matrices.length - 1; A >= 0; A--)
  {
    // scale
    for (var i = 0; i < 3; i++) {
      vector[i][0] *= matrices[A][15];
    }
    // rotate
    let rotationMatrix = [[matrices[A][0], matrices[A][1], matrices[A][2]], [matrices[A][4], matrices[A][5], matrices[A][6]], [matrices[A][8], matrices[A][9], matrices[A][10]]];
    vector = multiplyMatrices(rotationMatrix, vector);
    // transform
    vector[0][0] += matrices[A][3];
    vector[1][0] += matrices[A][7];
    vector[2][0] += matrices[A][11];
  }
  return vector;
}

function crossProduct(v1, v2) {
  return [[v1[1][0] * v2[2][0] - v1[2][0] * v2[1][0]], [v1[2][0] * v2[0][0] - v1[0][0] * v2[2][0]], [v1[0][0] * v2[1][0] - v1[1][0] * v2[0][0]]];
}

async function getAssemblyInfo(d='', wvm='', e='', suppressed=false, credentials='') {
    const url = 'https://ubcsubbots.onshape.com/api/v9/assemblies' + d + wvm + e + '?includeMateFeatures=false&includeNonSolids=false&includeMateConnectors=false&excludeSuppressed=' + !suppressed;
    const response = await fetch(url, {
      mode: 'no-cors',
      method: 'GET', 
      headers: {
        'Content-Type': 'application/json', 
        'Accept': 'application/json;charset=UTF-8;qs=0.09', 
        'Authorization': `Basic ${btoa(credentials)}`,
      }
    });
    return await response.json();
}

async function getPartMassProperties(d='', wvm='', e='', partid='', credentials='') {
  const url = 'https://ubcsubbots.onshape.com/api/v9/parts' + d + wvm + e + partid + '/massproperties?rollbackBarIndex=-1&inferMetadataOwner=true&useMassPropertyOverrides=false';
  const response = await fetch(url, {
    mode: 'no-cors',
    method: 'GET',
    headers: {
        'Content-Type': 'application/json', 
        'Accept': 'application/json;charset=UTF-8;qs=0.09', 
        'Authorization': `Basic ${btoa(credentials)}`,
    }
  });
  return await response.json();
}

async function exploreAssembly(d='', wvm='', e='', suppressed=false, credentials='') {
  let data = await getAssemblyInfo(d, wvm, e, suppressed, credentials);
  if (topLevel == null) {
    topLevel = await getAssemblyInfo(d, wvm, e, suppressed, credentials);
  }
  
  // const element = document.getElementById("myJSON");
  // element.innerHTML = str(data.rootAssembly.instances);
  // console.log(data.rootAssembly.instances);

  // console.log(data.rootAssembly.occurrences);

  // for (var component of data.rootAssembly.occurrences) {
  //   console.log(component);
  // }

  for (var component of data.rootAssembly.instances)
  {
    if (component.type == "Assembly") { // sub-assembly: requires exploration
      await exploreAssembly('/d/' + component.documentId, '/m/' + component.documentMicroversion, '/e/' + component.elementId, suppressed, credentials);
    }
    if (component.type == "Part") { // part: add to stack to be evaluated
      partsToEval.push(getPartMassProperties('/d/' + component.documentId, '/m/' + component.documentMicroversion, '/e/' + component.elementId, '/partid/' + component.partId, credentials));
      partIds.push(component.id);
    }
  }

  return;
}

async function evaluateParts() {
  await Promise.all(partsToEval).then(parts => { // evaluate all parts in this sub-assembly
    for (var i = 0; i < parts.length; i++) {
      let body = Object.values(parts[i].bodies)[0];

      let mass = body.mass[0];
      let massDisplaced = WATER_DENSITY * body.volume[0];

      totalMass += mass;
      totalMassDisplaced += massDisplaced;
 
      let position = [[body.centroid[0]], [body.centroid[1]], [body.centroid[2]]];

      let thisPart = topLevel.rootAssembly.occurrences.filter(obj => obj.path.at(-1) == partIds[i])[0];
      let thisTransform = thisPart.transform;

      position = transformVector([thisTransform], position);

      CG[0][0] += mass * position[0][0];
      CG[1][0] += mass * position[1][0];
      CG[2][0] += mass * position[2][0];

      CB[0][0] += massDisplaced * position[0][0];
      CB[1][0] += massDisplaced * position[1][0];
      CB[2][0] += massDisplaced * position[2][0];
    }
  });

  return;
}

async function exploreTopLevel() {
  let url = document.getElementById('url').value[0];
  let suppressed = document.getElementById('suppressed').checked;
  let credentials = document.getElementById('credentials').value[0];

  if (url == '' || credentials == '') {
    return;
  }

  let dPos = url.indexOf('/documents/');
  let wvmPos = url.indexOf('/w/');
  let ePos = url.indexOf('/e/');

  let d = '/d/' + url.slice(dPos + 11, wvmPos);
  let wvm = url.slice(wvmPos, ePos);
  let e = url.slice(ePos);

  console.log('Exploring assembly...');
  await exploreAssembly(d, wvm, e, suppressed, credentials);
  console.log('Evaluating parts...');
  await evaluateParts();

  for (var i = 0; i < 3; i++) {
    CG[i][0] /= totalMass;
    CB[i][0] /= totalMassDisplaced;
  }

  console.log('Mass (kg): ' + totalMass);
  console.log('G (m):');
  console.log(CG);
  console.log('B:');
  console.log(CB);

  let buoyantForce = GRAV_CONSTANT * totalMassDisplaced;
  let gravitationalForce = -GRAV_CONSTANT * totalMass;
  let netForce = buoyantForce + gravitationalForce;
  console.log('Net Force (N): ' + netForce);

  GB = [[CB[0][0] - CG[0][0]], [CB[1][0] - CG[1][0]], [CB[2][0] - CG[2][0]]];
  moment = crossProduct(GB, [[0], [0], [buoyantForce]]);
  console.log('Moment (Nm):');
  console.log(moment);
}