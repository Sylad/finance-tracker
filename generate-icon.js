const { Resvg } = require('@resvg/resvg-js');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const svgPath = 'E:\\Documents\\_home\\finance_tracker_icon.svg';
const outputPath = path.join(__dirname, 'finance-tracker.ico');

let svg = fs.readFileSync(svgPath, 'utf-8');

// Crop to the card area and make it square (380×380 centered on the card)
svg = svg
  .replace('viewBox="0 0 680 420"', 'viewBox="150 15 380 390"')
  .replace('width="100%"', 'width="256" height="256"');

const sizes = [16, 32, 48, 256];
const pngBuffers = [];

for (const size of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const rendered = resvg.render();
  pngBuffers.push(rendered.asPng());
}

pngToIco(pngBuffers).then(buf => {
  fs.writeFileSync(outputPath, buf);
  console.log('OK:', outputPath);
});
