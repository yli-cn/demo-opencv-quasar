import { Mat, MatVector, Point, Size } from "opencv-ts";
import { Line, LinePoint } from "src/types/opcv";

let imgFileArea = 0;

async function asyncResizeImgFile2Canvas(file: File | Blob) {
  const base64Url = await asyncAltImgFile2Base64Url(file);
  const { width, height } = await asyncGetImgFileRect(base64Url);
  const { toWidth, toHeight } = resizeRect500(width, height);
  imgFileArea = toWidth * toHeight;
  return await asyncPicaResizeImgFileMax2Canvas(file, Math.max(toWidth, toHeight));
}

function doColor(src: Mat) {
  const gray = new cvObj.Mat();
  cvObj.cvtColor(src, gray, cvObj.COLOR_RGBA2GRAY);
  cvObj.GaussianBlur(gray, gray, new cvObj.Size(3, 3), 0, 0, cvObj.BORDER_DEFAULT);
  return gray;
}

function doEdges(gray: Mat) {
  const edges = new cvObj.Mat();
  cvObj.Canny(gray, edges, 50, 100);
  return edges;
}

function _filterContours(edges: Mat) {
  const contours = new cvObj.MatVector();
  const hierarchy = new cvObj.Mat();
  cvObj.findContours(edges, contours, hierarchy, cvObj.RETR_LIST, cvObj.CHAIN_APPROX_SIMPLE);
  const contourArray = [];
  for (let i = 0; i < contours.size(); i++) {
    const _contour = contours.get(i);
    const _contourArea = cvObj.contourArea(_contour);
    if (_contourArea > imgFileArea / 10) {
      contourArray.push({ id: i, area: _contourArea });
    }
    _contour.delete();
  }
  contourArray.sort((a, b) => b.area - a.area);
  hierarchy.delete();
  return { contours, contourArray };
}

function doPolyContour(edges: Mat) {
  const { contours, contourArray } = _filterContours(edges);
  const polys = new cvObj.MatVector();
  for (let i = 0; i < contourArray.length; i++) {
    const cnt = contours.get(contourArray[i].id);
    const tmp = new cvObj.Mat();
    const arcLength = cvObj.arcLength(cnt, true);
    cvObj.approxPolyDP(cnt, tmp, arcLength * 0.01, true);
    if (tmp.total() === 4) {
      polys.push_back(cnt);
      cnt.delete();
      tmp.delete();
      break;
    }
    cnt.delete();
    tmp.delete();
  }
  contours.delete();
  return polys;
}

function doFillPoly(polyV: MatVector, size: Size) {
  const dark = new cvObj.Mat.zeros(size.height, size.width, cvObj.CV_8UC3);
  cvObj.fillPoly(dark, polyV, new cvObj.Scalar(255, 0, 0));
  return dark;
}

function doDilate(polyV: Mat) {
  const dilate = new cvObj.Mat();
  const M = new cvObj.Mat.ones(3, 3, cvObj.CV_8U);
  cvObj.dilate(
    polyV,
    dilate,
    M,
    new cvObj.Point(-1, -1),
    4,
    cvObj.BORDER_CONSTANT,
    cvObj.morphologyDefaultBorderValue()
  );
  M.delete();
  return dilate;
}

function doMinAreaRect(polysV: MatVector) {
  const poly = polysV.get(0);
  const rotatedRect = cvObj.minAreaRect(poly);
  poly.delete();
  return rotatedRect;
}

function doPolyDP(edges: Mat) {
  const { contours, contourArray } = _filterContours(edges);
  const polys = new cvObj.MatVector();
  for (let i = 0; i < contourArray.length; i++) {
    const cnt = contours.get(contourArray[i].id);
    const tmp = new cvObj.Mat();
    const arcLength = cvObj.arcLength(cnt, true);
    cvObj.approxPolyDP(cnt, tmp, arcLength * 0.01, true);
    if (tmp.total() === 4) {
      polys.push_back(tmp);
      cnt.delete();
      tmp.delete();
      break;
    }
    cnt.delete();
    tmp.delete();
  }
  contours.delete();
  return polys;
}

function doLines(edges: Mat) {
  const linea: Line[] = [];
  const lines = new cvObj.Mat();
  cvObj.HoughLines(edges, lines, 1, Math.PI / 180, 40);
  for (let i = 0; i < lines.rows; ++i) {
    const rho = lines.data32F[i * 2];
    const theta = lines.data32F[i * 2 + 1];
    linea.push(new Line(rho, theta));
  }
  lines.delete();
  // FIXME
  getClusterPoints(getCrossPoints(linea));
  return linea;
}

function doLinesP(edges: Mat) {
  const linea: LinePoint[] = [];
  const lines = new cvObj.Mat();
  cvObj.HoughLinesP(edges, lines, 1, Math.PI / 180, 1);
  for (let i = 0; i < lines.rows; ++i) {
    const startPoint = new cvObj.Point(lines.data32S[i * 4], lines.data32S[i * 4 + 1]);
    const endPoint = new cvObj.Point(lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3]);
    if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) {
      linea.push(new LinePoint(startPoint, endPoint));
    }
  }
  lines.delete();
  return linea;
}

function _getCrossPoint(l1: Line, l2: Line) {
  if (Math.abs(l1.theta - l2.theta) < Math.PI / 8) {
    return;
  }
  // y = a * x + b
  const a1 =
    Math.abs(l1.startPoint.x - l1.endPoint.x) < Number.EPSILON
      ? 0
      : (l1.startPoint.y - l1.endPoint.y) / (l1.startPoint.x - l1.endPoint.x);
  const b1 = l1.startPoint.y - a1 * l1.startPoint.x;
  const a2 =
    Math.abs(l2.startPoint.x - l2.endPoint.x) < Number.EPSILON
      ? 0
      : (l2.startPoint.y - l2.endPoint.y) / (l2.startPoint.x - l2.endPoint.x);
  const b2 = l2.startPoint.y - a2 * l2.startPoint.x;
  if (Math.abs(a2 - a1) > Number.EPSILON) {
    const x = (b1 - b2) / (a2 - a1);
    const y = a1 * x + b1;
    return new cvObj.Point(x, y);
  }
}

function getCrossPoints(lines: Line[]) {
  const points: Point[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const point = _getCrossPoint(lines[i], lines[j]);
      if (point) {
        points.push(point);
      }
    }
  }
  return points;
}

function _isNearDist(p1: Point, p2: Point) {
  const x = Math.abs(p1.x - p2.x);
  const y = Math.abs(p1.y - p2.y);
  const dist = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
  const sqrt = Math.sqrt(imgFileArea);
  console.log("sqrt / 100", sqrt / 100);
  return dist < sqrt / 100;
}

function getClusterPoints(points: Point[]) {
  const pointsCenter = {
    x: points.reduce((sum, cur) => sum + cur.x, 0) / points.length,
    y: points.reduce((sum, cur) => sum + cur.y, 0) / points.length,
  };
  points.sort((p1, p2) => {
    const theta1 = Math.atan((p1.y - pointsCenter.y) / (p1.x - pointsCenter.x || 0.01));
    const theta2 = Math.atan((p2.y - pointsCenter.y) / (p2.x - pointsCenter.x || 0.01));
    return theta1 - theta2;
  });
  const clusters: Point[][] = [[]];
  for (let i = 1; i < points.length; i++) {
    if (_isNearDist(points[i], points[i - 1])) {
      clusters[clusters.length - 1].push(points[i]);
    } else {
      clusters.push([points[i]]);
    }
  }
  const point4 = clusters
    .sort((c1, c2) => c2.length - c1.length)
    .slice(0, 4)
    .map((i) => {
      const x = ~~(i.reduce((sum, cur) => sum + cur.x, 0) / i.length);
      const y = ~~(i.reduce((sum, cur) => sum + cur.y, 0) / i.length);
      return new cvObj.Point(x, y);
    });
  const cluster4Center = {
    x: point4.reduce((sum, cur) => sum + cur.x, 0) / 4,
    y: point4.reduce((sum, cur) => sum + cur.y, 0) / 4,
  };
  const vertex: Point[] = [];
  vertex.push(<Point>point4.find((i) => i.x < cluster4Center.x && i.y < cluster4Center.y));
  vertex.push(<Point>point4.find((i) => i.x > cluster4Center.x && i.y < cluster4Center.y));
  vertex.push(<Point>point4.find((i) => i.x > cluster4Center.x && i.y > cluster4Center.y));
  vertex.push(<Point>point4.find((i) => i.x < cluster4Center.x && i.y > cluster4Center.y));
  return vertex;
}

export {
  asyncResizeImgFile2Canvas,
  doColor,
  doEdges,
  doPolyContour,
  doFillPoly,
  doDilate,
  doMinAreaRect,
  doPolyDP,
  doLines,
  doLinesP,
};
