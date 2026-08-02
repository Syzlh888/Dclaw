// 大批量中文测试数据生成
const { Client } = require('/app/node_modules/pg');
const c = new Client({host:'postgres',port:5432,user:'dclaw',password:'DClaw@2024Pwd',database:'dclaw'});
c.connect().then(async () => {
  console.log('==> CREATE 4 张大表');
  await c.query(`
    CREATE TABLE source_data.appointments (
      id BIGSERIAL PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_id INT NOT NULL,
      doctor_name TEXT NOT NULL,
      department TEXT NOT NULL,
      appointment_date TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      fee NUMERIC(10,2),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  appointments');

  await c.query(`
    CREATE TABLE source_data.prescriptions (
      id BIGSERIAL PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_id INT NOT NULL,
      drug_name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration_days INT NOT NULL,
      quantity INT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  prescriptions');

  await c.query(`
    CREATE TABLE source_data.lab_results (
      id BIGSERIAL PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_id INT NOT NULL,
      test_name TEXT NOT NULL,
      test_value TEXT NOT NULL,
      unit TEXT,
      reference_range TEXT,
      result_status TEXT,
      test_date TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  lab_results');

  await c.query(`
    CREATE TABLE source_data.visits (
      id BIGSERIAL PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_id INT NOT NULL,
      visit_date TIMESTAMPTZ NOT NULL,
      diagnosis TEXT NOT NULL,
      treatment TEXT,
      doctor_name TEXT NOT NULL,
      fee NUMERIC(10,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  visits');

  console.log('==> INSERT appointments (60,000 行)');
  await c.query(`
    INSERT INTO source_data.appointments (patient_name, patient_id, doctor_name, department, appointment_date, status, fee, notes, updated_at)
    SELECT
      '病人_' || (i % 50000),
      (i % 50000) + 1,
      CASE (i % 20)
        WHEN 0 THEN '张医生'
        WHEN 1 THEN '李医生'
        WHEN 2 THEN '王医生'
        WHEN 3 THEN '赵医生'
        WHEN 4 THEN '钱医生'
        WHEN 5 THEN '孙医生'
        WHEN 6 THEN '周医生'
        WHEN 7 THEN '吴医生'
        WHEN 8 THEN '郑医生'
        WHEN 9 THEN '陈医生'
        ELSE '医师_' || (i % 10)
      END,
      CASE (i % 10)
        WHEN 0 THEN '内科'
        WHEN 1 THEN '外科'
        WHEN 2 THEN '儿科'
        WHEN 3 THEN '妇产科'
        WHEN 4 THEN '骨科'
        WHEN 5 THEN '眼科'
        WHEN 6 THEN '耳鼻喉科'
        WHEN 7 THEN '皮肤科'
        WHEN 8 THEN '口腔科'
        ELSE '中医科'
      END,
      NOW() - (i || ' hours')::interval,
      CASE (i % 5)
        WHEN 0 THEN '已预约'
        WHEN 1 THEN '已完成'
        WHEN 2 THEN '已取消'
        WHEN 3 THEN '待确认'
        ELSE '进行中'
      END,
      100 + (i % 500),
      CASE (i % 4)
        WHEN 0 THEN '复诊提醒'
        WHEN 1 THEN '携带病历'
        WHEN 2 THEN '空腹检查'
        ELSE '常规'
      END,
      NOW() - (i || ' hours')::interval
    FROM generate_series(1, 60000) AS i
  `);
  console.log('  appointments done');

  console.log('==> INSERT prescriptions (80,000 行)');
  await c.query(`
    INSERT INTO source_data.prescriptions (patient_name, patient_id, drug_name, dosage, frequency, duration_days, quantity, notes, updated_at)
    SELECT
      '病人_' || (i % 50000),
      (i % 50000) + 1,
      CASE (i % 15)
        WHEN 0 THEN '阿莫西林胶囊'
        WHEN 1 THEN '布洛芬缓释胶囊'
        WHEN 2 THEN '复方甘草片'
        WHEN 3 THEN '盐酸二甲双胍片'
        WHEN 4 THEN '硝苯地平缓释片'
        WHEN 5 THEN '阿司匹林肠溶片'
        WHEN 6 THEN '奥美拉唑肠溶胶囊'
        WHEN 7 THEN '头孢克肟分散片'
        WHEN 8 THEN '氨氯地平片'
        WHEN 9 THEN '辛伐他汀片'
        WHEN 10 THEN '二甲双胍片'
        WHEN 11 THEN '氯吡格雷片'
        WHEN 12 THEN '厄贝沙坦片'
        WHEN 13 THEN '美托洛尔缓释片'
        ELSE '维生素C片'
      END,
      CASE (i % 4)
        WHEN 0 THEN '0.25g*24片'
        WHEN 1 THEN '0.5g*12片'
        WHEN 2 THEN '10mg*30片'
        ELSE '50mg*20片'
      END,
      CASE (i % 4)
        WHEN 0 THEN '每日三次'
        WHEN 1 THEN '每日两次'
        WHEN 2 THEN '每日一次'
        ELSE '睡前服用'
      END,
      (i % 30) + 3,
      (i % 20) + 1,
      CASE (i % 5)
        WHEN 0 THEN '饭后服用'
        WHEN 1 THEN '空腹服用'
        WHEN 2 THEN '忌辛辣'
        WHEN 3 THEN '多饮水'
        ELSE '常规'
      END,
      NOW() - (i || ' hours')::interval
    FROM generate_series(1, 80000) AS i
  `);
  console.log('  prescriptions done');

  console.log('==> INSERT lab_results (50,000 行)');
  await c.query(`
    INSERT INTO source_data.lab_results (patient_name, patient_id, test_name, test_value, unit, reference_range, result_status, test_date, updated_at)
    SELECT
      '病人_' || (i % 50000),
      (i % 50000) + 1,
      CASE (i % 12)
        WHEN 0 THEN '血常规'
        WHEN 1 THEN '尿常规'
        WHEN 2 THEN '肝功能'
        WHEN 3 THEN '肾功能'
        WHEN 4 THEN '血糖'
        WHEN 5 THEN '血脂'
        WHEN 6 THEN '心电图'
        WHEN 7 THEN '胸片'
        WHEN 8 THEN '腹部B超'
        WHEN 9 THEN '心肌酶谱'
        WHEN 10 THEN '凝血功能'
        ELSE '尿微量白蛋白'
      END,
      CASE (i % 4)
        WHEN 0 THEN '正常'
        WHEN 1 THEN '偏高'
        WHEN 2 THEN '偏低'
        ELSE '需复查'
      END,
      CASE (i % 6)
        WHEN 0 THEN 'g/L'
        WHEN 1 THEN 'mmol/L'
        WHEN 2 THEN 'mg/dL'
        WHEN 3 THEN 'U/L'
        WHEN 4 THEN '%'
        ELSE 'mmol/L'
      END,
      CASE (i % 4)
        WHEN 0 THEN '3.5-5.5'
        WHEN 1 THEN '0.6-1.2'
        WHEN 2 THEN '70-110'
        ELSE '阴性'
      END,
      CASE (i % 3)
        WHEN 0 THEN '正常'
        WHEN 1 THEN '异常'
        ELSE '需关注'
      END,
      NOW() - (i || ' hours')::interval,
      NOW() - (i || ' hours')::interval
    FROM generate_series(1, 50000) AS i
  `);
  console.log('  lab_results done');

  console.log('==> INSERT visits (50,000 行)');
  await c.query(`
    INSERT INTO source_data.visits (patient_name, patient_id, visit_date, diagnosis, treatment, doctor_name, fee, updated_at)
    SELECT
      '病人_' || (i % 50000),
      (i % 50000) + 1,
      NOW() - (i || ' hours')::interval,
      CASE (i % 20)
        WHEN 0 THEN '上呼吸道感染'
        WHEN 1 THEN '急性胃肠炎'
        WHEN 2 THEN '高血压'
        WHEN 3 THEN '糖尿病'
        WHEN 4 THEN '冠心病'
        WHEN 5 THEN '支气管炎'
        WHEN 6 THEN '过敏性鼻炎'
        WHEN 7 THEN '胃炎'
        WHEN 8 THEN '关节炎'
        WHEN 9 THEN '颈椎病'
        WHEN 10 THEN '腰椎间盘突出'
        WHEN 11 THEN '中耳炎'
        WHEN 12 THEN '结膜炎'
        WHEN 13 THEN '皮炎'
        WHEN 14 THEN '湿疹'
        WHEN 15 THEN '痛经'
        WHEN 16 THEN '失眠'
        WHEN 17 THEN '焦虑症'
        WHEN 18 THEN '骨质疏松'
        ELSE '健康体检'
      END,
      CASE (i % 6)
        WHEN 0 THEN '药物治疗+定期复查'
        WHEN 1 THEN '保守治疗观察'
        WHEN 2 THEN '需进一步检查'
        WHEN 3 THEN '建议住院治疗'
        WHEN 4 THEN '手术治疗评估'
        ELSE '健康指导'
      END,
      CASE (i % 20)
        WHEN 0 THEN '张医生'
        WHEN 1 THEN '李医生'
        WHEN 2 THEN '王医生'
        WHEN 3 THEN '赵医生'
        WHEN 4 THEN '钱医生'
        WHEN 5 THEN '孙医生'
        WHEN 6 THEN '周医生'
        WHEN 7 THEN '吴医生'
        WHEN 8 THEN '郑医生'
        WHEN 9 THEN '陈医生'
        ELSE '医师_' || (i % 10)
      END,
      (50 + (i % 500))::numeric(10,2),
      NOW() - (i || ' hours')::interval
    FROM generate_series(1, 50000) AS i
  `);
  console.log('  visits done');

  console.log('==> 验证行数');
  for (const t of ['appointments', 'prescriptions', 'lab_results', 'visits', 'patients', 'departments']) {
    const r = await c.query(`SELECT COUNT(*) FROM source_data.${t}`);
    console.log(`  source_data.${t}: ${r.rows[0].count} 行`);
  }

  // 同时建 4 张空 target 表
  console.log('==> CREATE 4 张空 target 表');
  await c.query(`
    CREATE TABLE target_data.appointments_export (
      id BIGINT PRIMARY KEY,
      patient_name TEXT, patient_id INT, doctor_name TEXT, department TEXT,
      appointment_date TIMESTAMPTZ, status TEXT, fee NUMERIC(10,2), notes TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE target_data.prescriptions_export (
      id BIGINT PRIMARY KEY,
      patient_name TEXT, patient_id INT, drug_name TEXT, dosage TEXT,
      frequency TEXT, duration_days INT, quantity INT, notes TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE target_data.lab_results_export (
      id BIGINT PRIMARY KEY,
      patient_name TEXT, patient_id INT, test_name TEXT, test_value TEXT,
      unit TEXT, reference_range TEXT, result_status TEXT, test_date TIMESTAMPTZ,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE target_data.visits_export (
      id BIGINT PRIMARY KEY,
      patient_name TEXT, patient_id INT, visit_date TIMESTAMPTZ,
      diagnosis TEXT, treatment TEXT, doctor_name TEXT, fee NUMERIC(10,2),
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  4 张 target 表已建');

  await c.end();
  console.log('OK');
});