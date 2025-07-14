import * as THREE from "three";

class HitInfo {
  constructor(t = Infinity, hit = null, normal = null, color = null, object = null) {
    this.t = t;
    this.hit = hit;
    this.normal = normal;
    this.color = color;
    this.object = object;
  }
}

class Primitive {
  constructor(color, reflectivity = 0, transparency = 0, refractionIdx = 1) {
    this.matrix = new THREE.Matrix4();
    this.color = color;
    this.reflectivity = reflectivity;
    this.transparency = transparency;
    this.refractionIdx = refractionIdx;
  }

  computeWorldMatrix(parentMatrix) {
    return new THREE.Matrix4().multiplyMatrices(parentMatrix, this.matrix);
  }

  // Override in subclasses
  intersect(rayOrigin, rayDir, worldMatrix) {
    return null;
  }
}

class Sphere extends Primitive {
  constructor(center, radius, color, reflectivity = 0, transparency = 0, refractionIdx = 1) {
    super(color, reflectivity, transparency, refractionIdx);
    this.localCenter = center.clone();
    this.radius = radius;
  }

  intersect(rayOrigin, rayDir, worldMatrix) {
    const center = this.localCenter.clone().applyMatrix4(worldMatrix);
    const L = new THREE.Vector3().subVectors(rayOrigin, center);
    const a = rayDir.dot(rayDir);
    const b = 2 * rayDir.dot(L);
    const c = L.dot(L) - this.radius * this.radius;
    const disc = b * b - 4 * a * c;

    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return null;

    const hit = new THREE.Vector3().addVectors(rayOrigin, rayDir.clone().multiplyScalar(t));
    const normal = new THREE.Vector3().subVectors(hit, center).normalize();
    return new HitInfo(t, hit, normal, this.color, this);
  }
}

class Triangle extends Primitive {
  constructor(v0, v1, v2, color, reflectivity = 0, transparency = 0, refractionIdx = 1) {
    super(color, reflectivity, transparency, refractionIdx);
    this.v0 = v0.clone();
    this.v1 = v1.clone();
    this.v2 = v2.clone();
  }
  
  intersect(rayOrigin, rayDir, worldMatrix) {
    const v0 = this.v0.clone().applyMatrix4(worldMatrix);
    const v1 = this.v1.clone().applyMatrix4(worldMatrix);
    const v2 = this.v2.clone().applyMatrix4(worldMatrix);
    
    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    
    const N = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    const Nu = N.dot(rayDir);
    if (Math.abs(Nu) < 1e-6){
      return null;
    }
    
    const D = -N.dot(v0);
    const s = -(D + N.dot(rayOrigin)) / Nu;
    if (s < 0.001) {
      return null;
    }
    
    const p = rayOrigin.clone().add(rayDir.clone().multiplyScalar(s));
    const hitsubv0 = new THREE.Vector3().subVectors(p, v0);
    
    const dot00 = edge2.dot(edge2);
    const dot01 = edge2.dot(edge1);
    const dot02 = edge2.dot(hitsubv0);
    const dot11 = edge1.dot(edge1);
    const dot12 = edge1.dot(hitsubv0);
    
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-10) {
      return null;
    }
    const beta = (dot11 * dot02 - dot01 * dot12) / denom;
    const gamma = (dot00 * dot12 - dot01 *dot02) / denom;
    const alpha = 1 - beta - gamma;
    
    if (alpha < 0 || beta < 0 || gamma < 0) {
      return null;
    }
    
    const normal = N.clone();
    if (normal.dot(rayDir) > 0) {
      normal.negate();
    }
    
    return new HitInfo(s, p, normal, this.color, this);
  }
}

function Mesh(cp, sc, p, ns) {
  const allbaseCurvePoints = [];
  
  for (let i = 0; i < ns; i++) {
    const scale = new THREE.Vector3(sc[i], sc[i], sc[i]);
    const position = new THREE.Vector3(p[i][0], p[i][1], p[i][2]);
    
    const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    const translationMatrix = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z);
    
    const transformMatrix = new THREE.Matrix4().multiply(translationMatrix).multiply(scaleMatrix);
    const transformedpoints = cp.map((point) => point.clone().applyMatrix4(transformMatrix));
    allbaseCurvePoints.push(transformedpoints);
  }
  
  const positions = [];
  const indices = [];
  const rows = allbaseCurvePoints.length;
  const cols = cp.length;
  
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const pt = allbaseCurvePoints[i][j];
      positions.push([pt.x, pt.y, pt.z]);
    }
  }
  
  for (let i = 0; i < rows - 1; i++) {
    for (let j =0; j < cols; j++) {
      const a = i * cols + j;
      const b = i * cols + (j + 1) % cols;
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + (j + 1) % cols;
      
      indices.push([a, b, d]);
      indices.push([a, d, c]);
    }
  }
  
  return {positions, indices};
}

class Group {
  constructor() {
    this.matrix = new THREE.Matrix4();
    this.children = [];
  }

  add(child) {
    this.children.push(child);
    return child;
  }

  computeWorldMatrix(parentMatrix) {
    return new THREE.Matrix4().multiplyMatrices(parentMatrix, this.matrix);
  }

  intersect(rayOrigin, rayDir, parentMatrix) {
    const worldMatrix = this.computeWorldMatrix(parentMatrix);
    let closestHit = null;

    for (const child of this.children) {
      const hit = child.intersect(rayOrigin, rayDir, worldMatrix);
      if (hit && (!closestHit || hit.t < closestHit.t)) {
        closestHit = hit;
      }
    }
    return closestHit;
  }
}

// compute reflectivity
function reflect(V, N) {
  return V.clone().sub(N.clone().multiplyScalar(2 * V.dot(N))).normalize();
}

// compute refractivity
function refract(L, N, nr) {
  L = L.clone().normalize();
  N = N.clone().normalize();
  let cosi = L.dot(N);
  let ni = 1;
  let n = N.clone();
  if (cosi < 0) {
    cosi = -cosi;
  } else {
    [ni, nr] = [nr, ni];
    n.negate();
  }
  const eta = ni / nr;
  const cos2r = 1 - eta * eta * (1 - cosi * cosi);
  if (cos2r < 0) {
    return null;
  } else {
    const cosr = Math.sqrt(cos2r);
    return L.clone().multiplyScalar(eta).add(n.multiplyScalar(eta * cosi - cosr)).normalize();
  }
}

function traceRay(rayOrigin, rayDir, sceneRoot, depth) {
  if (depth <= 0) {
    return new THREE.Color(0, 0, 0);
  }
  
  const hit = sceneRoot.intersect(rayOrigin, rayDir, new THREE.Matrix4());
  if (!hit) {
    return new THREE.Color(0, 0, 0);
  }
  
  const lightPos = new THREE.Vector3(0, 2.8, 0);
  const lightDir = lightPos.clone().sub(hit.hit).normalize();
  
  const epsilon = 0.01;
  
  const shadowOrigin = hit.hit.clone().add(hit.normal.clone().multiplyScalar(epsilon));
  const shadowHit = sceneRoot.intersect(shadowOrigin, lightDir, new THREE.Matrix4());
  
  let color = new THREE.Color();
  
  if (shadowHit && shadowHit.t < lightPos.distanceTo(hit.hit)) {
    color.copy(hit.color).multiplyScalar(0.2);
  } else {
    const diffuse = Math.max(0, hit.normal.dot(lightDir));
    color.copy(hit.color).multiplyScalar(0.3 + 0.7 * diffuse);
  }
  
  if (hit.object.reflectivity > 0) {
    const reflectDir = reflect(rayDir, hit.normal);
    const reflectOrigin = hit.hit.clone().add(hit.normal.clone().multiplyScalar(epsilon));
    const reflectedColor = traceRay(reflectOrigin, reflectDir, sceneRoot, depth - 1);
    color.add(reflectedColor.multiplyScalar(hit.object.reflectivity));
  }
  
  if (hit.object.transparency > 0) {
    const refractDir = refract(rayDir, hit.normal, hit.object.refractionIdx);
    if (refractDir) {
      const refractOrigin = hit.hit.clone().add(refractDir.clone().multiplyScalar(epsilon));
      const refractedColor = traceRay(refractOrigin, refractDir, sceneRoot, depth - 1);
      const k = hit.object.transparency;
      const surfaceColor = color.clone();
      color.add(surfaceColor.multiplyScalar(1 - k).add(refractedColor.multiplyScalar(k)));
    }
  }
  return color;
}

function renderRaytracedScene(canvas, sceneRoot, eye, viewSize, imgWidth, imgHeight) {
  const ctx = canvas.getContext("2d");
  canvas.width = imgWidth;
  canvas.height = imgHeight;
  const imageData = ctx.createImageData(imgWidth, imgHeight);

  const aspect = imgWidth / imgHeight;
  const w = viewSize;
  const h = w / aspect;

  const lightDir = new THREE.Vector3(-1, 1, -1).normalize();
  const samplesPerPixel = 4;
  const sqrtSamples = Math.sqrt(samplesPerPixel);

  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      let rAcc = 0, gAcc = 0, bAcc = 0;

      for (let sy = 0; sy < sqrtSamples; sy++) {
        for (let sx = 0; sx < sqrtSamples; sx++) {
          const offsetX = (sx + 0.5) / sqrtSamples;
          const offsetY = (sy + 0.5) / sqrtSamples;

          const u = ((x + offsetX) / imgWidth - 0.5) * w;
          const v = (0.5 - (y + offsetY) / imgHeight) * h;

          const rayDir = new THREE.Vector3(u, v, 1).normalize();
          const color = traceRay(eye, rayDir, sceneRoot, 3);
          
          rAcc += color.r * 255;
          gAcc += color.g * 255;
          bAcc += color.b * 255;
        }
      }

      const scale = 1 / samplesPerPixel;
      const idx = (y * imgWidth + x) * 4;
      imageData.data[idx]     = rAcc * scale;
      imageData.data[idx + 1] = gAcc * scale;
      imageData.data[idx + 2] = bAcc * scale;
      imageData.data[idx + 3] = 255;
    }
  } 
  ctx.putImageData(imageData, 0, 0);
}

window.onload = () => {
  const canvas = document.getElementById("canvas");
  const root = new Group();
  
  const red = new THREE.Color(1, 0, 0);
  const green = new THREE.Color(0, 1, 0);
  const white = new THREE.Color(1, 1, 1);
  
  const ceiling = new Group();
  ceiling.add(new Triangle(
    new THREE.Vector3(-3, 3, -3),
    new THREE.Vector3(3, 3, -3),
    new THREE.Vector3(3, 3, 3),
    white));
  ceiling.add(new Triangle(
    new THREE.Vector3(-3, 3, -3),
    new THREE.Vector3(3, 3, 3),
    new THREE.Vector3(-3, 3, 3),
    white));
  
  const wall1 = new Group();
  wall1.add(new Triangle(
    new THREE.Vector3(-3, -3, -3),
    new THREE.Vector3(-3, 3, -3),
    new THREE.Vector3(-3, 3, 3),
    red));
  wall1.add(new Triangle(
    new THREE.Vector3(-3, -3, -3),
    new THREE.Vector3(-3, 3, 3),
    new THREE.Vector3(-3, -3, 3),
    red));
  
  const wall2 = new Group();
  wall2.add(new Triangle(
    new THREE.Vector3(3, -3, -3),
    new THREE.Vector3(3, 3, 3),
    new THREE.Vector3(3, 3, -3),
    green));
  wall2.add(new Triangle(
    new THREE.Vector3(3, -3, -3),
    new THREE.Vector3(3, -3, 3),
    new THREE.Vector3(3, 3, 3),
    green));
  
  const wall3 = new Group();
  wall3.add(new Triangle(
    new THREE.Vector3(-3, -3, 3),
    new THREE.Vector3(-3, 3, 3),
    new THREE.Vector3(3, 3, 3),
    white));
  wall3.add(new Triangle(
    new THREE.Vector3(-3, -3, 3),
    new THREE.Vector3(3, 3, 3),
    new THREE.Vector3(3, -3, 3),
    white));
  
  const floor = new Group();
  floor.add(new Triangle(
    new THREE.Vector3(-3, -3, -3),
    new THREE.Vector3(3, -3, 3),
    new THREE.Vector3(3, -3, -3),
    white));
  floor.add(new Triangle(
    new THREE.Vector3(-3, -3, -3),
    new THREE.Vector3(-3, -3, 3),
    new THREE.Vector3(3, -3, 3),
    white));
  
  root.add(ceiling);
  root.add(wall1);
  root.add(wall2);
  root.add(wall3);
  root.add(floor);
  
  const sphereColor = new THREE.Color(0.2, 0.2, 1);
  const pyramidColor = new THREE.Color(131 / 256, 105 / 256, 83 / 256);
  const hourglassColor = new THREE.Color(135 / 255, 206 / 255, 235 / 255);
  
  const sphere = new Sphere(new THREE.Vector3(-1.5, -2.5, -0.5), 0.5, sphereColor);
  
  const pyramid = new Group();
  // floor
  pyramid.add(new Triangle(
    new THREE.Vector3(-2, -3, 1),
    new THREE.Vector3(0, -3, 1),
    new THREE.Vector3(0, -3, 3),
    pyramidColor, 1, 0, 1));
  pyramid.add(new Triangle(
    new THREE.Vector3(-2, -3, 0),
    new THREE.Vector3(0, -3, 2),
    new THREE.Vector3(-2, -3, 2),
    pyramidColor, 1, 0, 1));
  //side
  pyramid.add(new Triangle(
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(0, -3, 0),
    new THREE.Vector3(-2, -3, 0),
    pyramidColor, 1, 0, 1));
  pyramid.add(new Triangle(
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(0, -3, 2),
    new THREE.Vector3(0, -3, 0),
    pyramidColor, 1, 0, 1));
  pyramid.add(new Triangle(
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(-2, -3, 2),
    new THREE.Vector3(0, -3, 2),
    pyramidColor, 1, 0, 1));
 pyramid.add(new Triangle(
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(-2, -3, 0),
    new THREE.Vector3(-2, -3, 2),
    pyramidColor, 1, 0, 1));
  
  const hourglass = new Group();
  
  const curvePoints = [
    new THREE.Vector3(-1.5, 0, 0),
    new THREE.Vector3(-1, 0, 1),
    new THREE.Vector3(0, 0, 1.5),
    new THREE.Vector3(1, 0, 1),
    new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(1, 0, -1),
    new THREE.Vector3(0, 0, -1.5),
    new THREE.Vector3(-1, 0, -1),
  ];
  
  const scale = [0.5, 0.25, 0.13, 0.25, 0.5];
  const position = [[1, -1, 0],
                   [1, -1.5, 0],
                   [1, -2, 0],
                   [1, -2.5, 0],
                   [1, -3, 0],]
  const nSections = 5;
  
  const {positions, indices} = Mesh(curvePoints, scale, position, nSections);
  
  for (let i = 0; i < indices.length; i++) {
    const [i0, i1, i2] = indices[i];
    if (i0 < positions.length && i1 < positions.length && i2 < positions.length) {
      const v0 = new THREE.Vector3(positions[i0][0], positions[i0][1], positions[i0][2]);
      const v1 = new THREE.Vector3(positions[i1][0], positions[i1][1], positions[i1][2]);
      const v2 = new THREE.Vector3(positions[i2][0], positions[i2][1], positions[i2][2]);
      hourglass.add(new Triangle(
      v0, v1, v2, hourglassColor, 0, 0.9, 1.3));
    }
  }
  
  root.add(pyramid);
  root.add(sphere);
  root.add(hourglass);
  const eye = new THREE.Vector3(0, 0, -3);
  renderRaytracedScene(canvas, root, eye, 2.5, 250, 250);
};
