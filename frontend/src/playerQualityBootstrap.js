// Force every hls.js playback to start from the highest quality variant.
// After startup, hls.js keeps its normal adaptive bitrate behaviour so it can
// recover gracefully on connections that cannot sustain the top rendition.
import Hls from "hls.js";

const PATCH_FLAG = "__flixitStartAtMaxQualityPatched";
const SOURCE_FLAG = "__flixitMaxStartApplied";

function isBetterLevel(candidate, current) {
  if (!current) return true;

  const candidateWidth = Number(candidate?.width) || 0;
  const candidateHeight = Number(candidate?.height) || 0;
  const currentWidth = Number(current?.width) || 0;
  const currentHeight = Number(current?.height) || 0;
  const candidatePixels = candidateWidth * candidateHeight;
  const currentPixels = currentWidth * currentHeight;

  if (candidatePixels !== currentPixels) return candidatePixels > currentPixels;
  if (candidateHeight !== currentHeight) return candidateHeight > currentHeight;
  if (candidateWidth !== currentWidth) return candidateWidth > currentWidth;

  return (Number(candidate?.bitrate) || 0) > (Number(current?.bitrate) || 0);
}

if (!Hls.prototype[PATCH_FLAG]) {
  const originalLoadSource = Hls.prototype.loadSource;
  const originalStartLoad = Hls.prototype.startLoad;

  Hls.prototype.loadSource = function loadSourceAtMaxQuality(url) {
    this[SOURCE_FLAG] = false;
    return originalLoadSource.call(this, url);
  };

  Hls.prototype.startLoad = function startLoadAtMaxQuality(startPosition = -1, skipSeekToStartPosition = false) {
    if (!this[SOURCE_FLAG]) {
      const levels = Array.isArray(this.levels) ? this.levels : [];
      if (levels.length > 0) {
        let bestIndex = 0;
        for (let index = 1; index < levels.length; index += 1) {
          if (isBetterLevel(levels[index], levels[bestIndex])) bestIndex = index;
        }

        // startLevel affects only the initial rendition. ABR remains enabled.
        this.startLevel = bestIndex;
        this[SOURCE_FLAG] = true;
      }
    }

    return originalStartLoad.call(this, startPosition, skipSeekToStartPosition);
  };

  Object.defineProperty(Hls.prototype, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
