/**
 * Pagination helper for Express controllers & MySQL queries
 */
function getPagination(req, defaultLimit = 10) {
  const isAll = req.query.limit === 'all';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = isAll
    ? 1000000
    : Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset,
    isAll,
    buildMeta: (totalCount) => {
      const total = parseInt(totalCount, 10) || 0;
      const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / limit));
      return {
        page: isAll ? 1 : page,
        limit: isAll ? total : limit,
        total,
        total_pages: totalPages,
        has_next: !isAll && page < totalPages,
        has_prev: !isAll && page > 1
      };
    }
  };
}

module.exports = { getPagination };
