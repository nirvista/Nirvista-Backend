const buildReferralTree = (users, rootId) => {
  const rootKey = rootId.toString();
  const nodeMap = new Map();

  users.forEach((user) => {
    const id = user._id.toString();
    const referralPath = user.referralPath || [];
    const depth = referralPath.findIndex((ref) => ref?.toString() === rootKey);
    nodeMap.set(id, {
      ...user,
      depth: depth === -1 ? 0
       : depth,
      children: [],
    });
  });

  nodeMap.forEach((node) => {
    if (node._id.toString() === rootKey) return;
    if (!node.referredBy) return;
    const parent = nodeMap.get(node.referredBy.toString());
    if (parent) {
      parent.children.push(node);
    }
  });

  return nodeMap.get(rootKey) || null;
};

module.exports = {
  buildReferralTree,
};
