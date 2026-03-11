import {state} from "./state.js";

// wrappers around the worldRender instance stored in state
export function isTexture47Block(block) {
  return state.worldRender?.isTexture47Block(block);
}

export function getTexture47IdFromBlock(block) {
  return state.worldRender?.getTexture47IdFromBlock(block);
}

export function getTileIdAtLayer(tileX, tileY, layer = "foreground") {
  return state.worldRender?.getTileIdAtLayer(tileX, tileY, layer);
}

export function sameTexture47Group(tileX, tileY, texture47Id, layer = "foreground") {
  return state.worldRender?.sameTexture47Group(tileX, tileY, texture47Id, layer);
}

export function getTexture47Mask(tileX, tileY, texture47Id, layer = "foreground") {
  return state.worldRender?.getTexture47Mask(tileX, tileY, texture47Id, layer);
}

export function drawConnected47TileToContext(targetContext, block, drawX, drawY, layer = "foreground") {
  return state.worldRender?.drawConnected47TileToContext(targetContext, block, drawX, drawY, layer);
}

export function drawTileToContext(targetContext, tileId, drawX, drawY, layer = "foreground") {
  state.worldRender && state.worldRender.drawTileToContext(targetContext, tileId, drawX, drawY, layer);
}

export function rebuildWorldRenderCache() {
  state.worldRender && state.worldRender.rebuildWorldRenderCache();
}

export function updateWorldRenderTile(tileX, tileY) {
  state.worldRender && state.worldRender.updateWorldRenderTile(tileX, tileY);
}

export function updateWorldRenderTileArea(centerX, centerY) {
  state.worldRender && state.worldRender.updateWorldRenderTileArea(centerX, centerY);
}
