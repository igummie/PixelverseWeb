export function createPhysicsController({ state, settings }) {
  const { EPSILON } = settings;

  function getForegroundTileId(world, tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= world.width || tileY >= world.height) {
      return 0;
    }

    const index = tileY * world.width + tileX;

    if (Array.isArray(world.foreground)) {
      return Number(world.foreground[index] || 0);
    }

    if (Array.isArray(world.tiles)) {
      return Number(world.tiles[index] || 0);
    }

    return 0;
  }

  function getBackgroundTileId(world, tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= world.width || tileY >= world.height) {
      return 0;
    }

    const index = tileY * world.width + tileX;
    if (Array.isArray(world.background)) {
      return Number(world.background[index] || 0);
    }

    return 0;
  }

  function getCollisionKind(tileId) {
    if (!tileId) {
      return null;
    }

    const block = state.blockDefs.get(tileId);
    const blockType = String(block?.BLOCK_TYPE || "SOLID").toUpperCase();

    if (blockType === "BACKGROUND") {
      return null;
    }

    if (blockType === "PLATFORM") {
      return "platform";
    }

    return "solid";
  }

  function getCollisionKindAt(world, tileX, tileY) {
    const foregroundKind = getCollisionKind(getForegroundTileId(world, tileX, tileY));
    if (foregroundKind) {
      return foregroundKind;
    }

    return getCollisionKind(getBackgroundTileId(world, tileX, tileY));
  }

  function resolveHorizontal(world, oldX, oldY, proposedX) {
    const width = state.collider.width;
    const height = state.collider.height;
    let x = proposedX;

    const top = oldY;
    const bottom = oldY + height - EPSILON;
    const startY = Math.floor(top);
    const endY = Math.floor(bottom);

    if (proposedX > oldX) {
      const right = proposedX + width - EPSILON;
      const tileX = Math.floor(right);
      for (let tileY = startY; tileY <= endY; tileY += 1) {
        if (getCollisionKindAt(world, tileX, tileY) === "solid") {
          x = Math.min(x, tileX - width);
        }
      }
    } else if (proposedX < oldX) {
      const left = proposedX;
      const tileX = Math.floor(left);
      for (let tileY = startY; tileY <= endY; tileY += 1) {
        if (getCollisionKindAt(world, tileX, tileY) === "solid") {
          x = Math.max(x, tileX + 1);
        }
      }
    }

    if (x < 0) {
      x = 0;
    }

    const maxX = world.width - width;
    if (x > maxX) {
      x = maxX;
    }

    return x;
  }

  function resolveVertical(world, currentX, oldY, proposedY, currentVelocityY) {
    const width = state.collider.width;
    const height = state.collider.height;
    let y = proposedY;
    let vy = currentVelocityY;
    let onGround = false;

    const left = currentX + EPSILON;
    const right = currentX + width - EPSILON;
    const startX = Math.floor(left);
    const endX = Math.floor(right);

    if (proposedY > oldY) {
      const oldBottom = oldY + height;
      const newBottom = proposedY + height;

      let collideTop = null;

      for (let tileX = startX; tileX <= endX; tileX += 1) {
        const startY = Math.floor(oldBottom - EPSILON);
        const endY = Math.floor(newBottom - EPSILON);

        for (let tileY = startY; tileY <= endY; tileY += 1) {
          const kind = getCollisionKindAt(world, tileX, tileY);

          if (!kind) {
            continue;
          }

          const tileTop = tileY;
          const crossedTop = oldBottom <= tileTop + 0.05 && newBottom >= tileTop;

          if (kind === "solid" && crossedTop) {
            collideTop = collideTop === null ? tileTop : Math.min(collideTop, tileTop);
          }

          if (kind === "platform" && crossedTop) {
            collideTop = collideTop === null ? tileTop : Math.min(collideTop, tileTop);
          }
        }
      }

      if (collideTop !== null) {
        y = collideTop - height;
        vy = 0;
        onGround = true;
      }
    } else if (proposedY < oldY) {
      const oldTop = oldY;
      const newTop = proposedY;

      let collideBottom = null;

      for (let tileX = startX; tileX <= endX; tileX += 1) {
        const startY = Math.floor(newTop);
        const endY = Math.floor(oldTop);

        for (let tileY = startY; tileY <= endY; tileY += 1) {
          const kind = getCollisionKindAt(world, tileX, tileY);

          if (kind !== "solid") {
            continue;
          }

          const tileBottom = tileY + 1;
          const crossedBottom = oldTop >= tileBottom - 0.05 && newTop <= tileBottom;
          if (crossedBottom) {
            collideBottom = collideBottom === null ? tileBottom : Math.max(collideBottom, tileBottom);
          }
        }
      }

      if (collideBottom !== null) {
        y = collideBottom;
        vy = 0;
      }
    }

    if (y < 0) {
      y = 0;
      vy = 0;
    }

    const maxY = world.height - height;
    if (y > maxY) {
      y = maxY;
      vy = 0;
      onGround = true;
    }

    return { y, vy, onGround };
  }

  return {
    getForegroundTileId,
    getBackgroundTileId,
    getCollisionKind,
    getCollisionKindAt,
    resolveHorizontal,
    resolveVertical,
  };
}
