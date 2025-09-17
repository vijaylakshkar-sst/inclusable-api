const pool = require('../../dbconfig');
const moment = require('moment');

const MONTHLY_TARGET = 1000;
exports.getCardsCount = async (req, res) => {
  try {
    const query = `
      SELECT role, COUNT(*) AS total
      FROM users
      WHERE role IN ('NDIS Member', 'Company')  AND deleted_at IS NULL
      GROUP BY role
    `;

    const { rows } = await pool.query(query);

    // Format to always return both roles, even if count is 0
    const result = {
      'NDIS Member': 0,
      'Company': 0,
    };

    rows.forEach(row => {
      result[row.role] = parseInt(row.total, 10);
    });

    res.json({ status: true, data: result });
  } catch (error) {
    console.error('Error fetching Card Count:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getMonthlyRoleCounts = async (req, res) => {
  try {
    const query = `
      WITH months AS (
        SELECT to_char(date_trunc('month', CURRENT_DATE) - interval '1 month' * generate_series(0, 11), 'Mon') AS month_label,
               to_char(date_trunc('month', CURRENT_DATE) - interval '1 month' * generate_series(0, 11), 'YYYY-MM') AS month_key
      )
      SELECT
        m.month_label,
        COALESCE(SUM(CASE WHEN u.role = 'NDIS Member' THEN 1 ELSE 0 END), 0) AS ndis_count,
        COALESCE(SUM(CASE WHEN u.role = 'Company' THEN 1 ELSE 0 END), 0) AS company_count
      FROM months m
      LEFT JOIN users u
        ON to_char(date_trunc('month', u.created_at), 'YYYY-MM') = m.month_key
       AND u.deleted_at IS NULL
      GROUP BY m.month_label, m.month_key
      ORDER BY m.month_key;
    `;

    const { rows } = await pool.query(query);

    const labels = rows.map((r) => r.month_label); // e.g., ['Sep', 'Aug', ...]
    const ndis = rows.map((r) => parseInt(r.ndis_count));
    const business = rows.map((r) => parseInt(r.company_count));

    res.json({
      status: true,
      data: {
        labels,
        ndis,
        business,
      },
    });
  } catch (err) {
    console.error('❌ Error fetching monthly role counts:', err.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getRecentUsers = async (req, res) => {
  try {
    const query = `
      SELECT id, full_name, email, role, phone_number, created_at
      FROM users
      WHERE role IN ('NDIS Member', 'Company') AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 10;
    `;

    const { rows } = await pool.query(query);

    res.json({
      status: true,
      data: rows,
    });
  } catch (error) {
    console.error('Error fetching recent users:', error.message);
    res.status(500).json({
      status: false,
      message: 'Internal Server Error',
    });
  }
};


exports.getMonthlyBookingRevenue = async (req, res) => {
  try {
    // Generate last 12 months series
    const query = `
      WITH months AS (
        SELECT to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' * generate_series(11,0,-1), 'Mon YYYY') AS month,
               date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' * generate_series(11,0,-1) AS month_start
      )
      SELECT
        m.month,
        COALESCE(SUM(b.total_amount), 0) AS total
      FROM months m
      LEFT JOIN event_bookings b
        ON date_trunc('month', b.created_at) = m.month_start
      GROUP BY m.month, m.month_start
      ORDER BY m.month_start;
    `;

    const result = await pool.query(query);

    const labels = [];
    const data = [];

    result.rows.forEach(row => {
      labels.push(row.month);
      data.push(parseFloat(row.total));
    });

    res.json({ status: true, data: { labels, data } });
  } catch (err) {
    console.error('Error fetching monthly booking revenue:', err.message);
    res.status(500).json({ status: false, error: 'Internal server error' });
  }
};


exports.getBookingDashboardStats = async (req, res) => {
  const client = await pool.connect();
  try {
    const today = moment().format('YYYY-MM-DD');
    const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');
    const endOfMonth = moment().endOf('month').format('YYYY-MM-DD');
    const startOfLastMonth = moment().subtract(1, 'months').startOf('month').format('YYYY-MM-DD');
    const endOfLastMonth = moment().subtract(1, 'months').endOf('month').format('YYYY-MM-DD');

    // 1. Today's bookings
    const { rows: todayRows } = await client.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM event_bookings WHERE DATE(created_at) = $1`,
      [today]
    );

    // 2. This month's bookings
    const { rows: monthRows } = await client.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM event_bookings WHERE created_at BETWEEN $1 AND $2`,
      [startOfMonth, endOfMonth]
    );

    // 3. Last month's bookings (for comparison)
    const { rows: lastMonthRows } = await client.query(
      `SELECT COALESCE(SUM(total_amount), 0) as amount FROM event_bookings WHERE created_at BETWEEN $1 AND $2`,
      [startOfLastMonth, endOfLastMonth]
    );

    const target = 1000;
    const todayBookings = parseInt(todayRows[0].count);
    const todayAmount = parseFloat(todayRows[0].amount);
    const monthlyBookings = parseInt(monthRows[0].count);
    const monthlyAmount = parseFloat(monthRows[0].amount);
    const lastMonthAmount = parseFloat(lastMonthRows[0].amount);

    const percentageAchieved = ((monthlyBookings / target) * 100).toFixed(2);

    const changePercentage = lastMonthAmount > 0
      ? (((monthlyAmount - lastMonthAmount) / lastMonthAmount) * 100).toFixed(2)
      : 100;

    return res.json({
      status: true,
      data:{target,
      todayBookings,
      monthlyBookings,
      percentageAchieved: Number(percentageAchieved),
      changePercentage: Number(changePercentage),
      todayAmount,
      monthlyAmount,
      lastMonthAmount
      }
    });

  } catch (error) {
    console.error('Error fetching booking stats:', error.message);
    res.status(500).json({status: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
};
