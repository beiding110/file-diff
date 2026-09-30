// 实体提取断言基准：基于汉语名词短语规律构造的场景句集
// 用法：node test/test_entity_regression.js
// 改动提取逻辑后跑本文件：红项 = 行为变化，需人工确认是否符合语言规律再更新期望
const EntityExtracter = require('../utils/EntityExtracter');

// 场景句与断言。mustInclude/mustExclude 的实体按「精确相等」或「包含子串」判定：
// 字符串为精确匹配，前缀 ~ 表示包含匹配
const CASES = [
    {
        name: '招投标典型句',
        text: [
            '招标编号：ZB-2023-0518。',
            '招标人：石家庄市第二建筑工程有限公司，地址位于河北省石家庄市裕华区槐安东路88号。',
            '投标单位：保定市政建设集团有限公司、北京中铁建工集团股份有限公司。',
            '项目联系人：张伟，联系电话13812345678，固定电话0311-87654321。',
            '代理机构：河北恒信工程项目管理有限公司受邯郸市住房和城乡建设局委托。',
            '本工程位于唐山海港开发区，总建筑面积约35000平方米。',
            '评标专家：李秀兰、王建国、刘德華。',
            '投标人须在邢台市信都区行政审批局完成备案。',
            '系统平台：全国公共资源交易平台（河北省·邢台市）。',
            '报名截止时间：2023年5月30日，逾期不予受理。',
            '开户银行：中国工商银行石家庄分行，账号0402021029300123456。',
            '详见《中华人民共和国招标投标法》及《河北省建设工程招标投标管理条例》。',
        ].join('\n'),
        include: [
            ['organization', '石家庄市第二建筑工程有限公司'],
            ['organization', '保定市政建设集团有限公司'],
            ['organization', '北京中铁建工集团股份有限公司'],
            ['organization', '邢台市信都区行政审批局'],
            ['organization', '中国工商银行石家庄分行'],
            // 谓语「受」断开后，两侧机构各自独立完整
            ['organization', '河北恒信工程项目管理有限公司'],
            ['organization', '邯郸市住房和城乡建设局'],
            ['location', '河北省石家庄市裕华区'],
            ['location', '唐山海港开发区'],
            ['location', '邢台市信都区'],
            ['system', '全国公共资源交易平台'],
            ['person', '王建国'],
            ['time', '2023年5月30日'],
            ['mobile', '13812345678'],
            ['tel', '0311-87654321'],
            ['paper', '《中华人民共和国招标投标法》'],
        ],
        exclude: [
            // 谓语「受」不得把两个机构粘成一个
            ['organization', '~受邯郸'],
            ['location', '~受邯郸'],
            ['location', '~有限公司受'],
        ],
    },
    {
        name: '谓语断点：实体+谓语+实体',
        text: '本项目由湖北CA科技有限公司承建，建设单位为邢台市城建集团有限公司。',
        include: [
            ['organization', '湖北CA科技有限公司'],
            ['organization', '邢台市城建集团有限公司'],
        ],
        exclude: [],
    },
    {
        name: '系动词断点：实体A是实体B',
        text: '湖北CA是湖北省优秀企业。',
        include: [['location', '湖北省']],
        exclude: [['location', '~是湖北省']],
    },
    {
        name: '连词断点：公司A与公司B',
        text: '河北城建施工有限公司与保定安装工程有限公司均中标。',
        include: [
            ['organization', '河北城建施工有限公司'],
            ['organization', '保定安装工程有限公司'],
        ],
        exclude: [['organization', '~与保定']],
    },
    {
        name: '部委名含连词与整词实体',
        text: '工业和信息化部与住房和城乡建设部联合发布通知。',
        include: [
            ['organization', '工业和信息化部'],
            ['organization', '住房和城乡建设部'],
        ],
        exclude: [],
    },
    {
        name: '中英混排机构名',
        text: 'IBM中国有限公司与Microsoft中国区总部建立合作。',
        include: [['organization', '~IBM中国有限公司']],
        exclude: [],
    },
    {
        name: '量词数词多级地址',
        text: '办公地址为北京市海淀区中关村大街1号3层A座305室。',
        include: [['location', '北京市海淀区中关村大街1号3层A座305室']],
        exclude: [],
    },
    {
        name: '括号机构名不裁字号',
        text: '本项目由中铁建工集团有限公司（北京）分公司负责施工。',
        include: [['organization', '中铁建工集团有限公司（北京）分公司']],
        exclude: [],
    },
    {
        name: '系统名不被谓语动宾吞并',
        text: '在邢台市人社一体化平台办理社保参保业务。',
        include: [['system', '邢台市人社一体化平台']],
        exclude: [['system', '~办理']],
    },
    {
        name: '弱后缀泛词不触发 system',
        text: '员工上网行为规范与运维管网建设方案。',
        include: [],
        exclude: [['system', '~上网'], ['system', '~管网']],
    },
];

// include 里精确匹配；exclude 里 ~ 前缀表示「任何实体不得包含该子串」
let pass = 0;
let fail = 0;

for (const { name, text, include, exclude } of CASES) {
    const result = new EntityExtracter(text).extract();

    for (const [type, expected] of include) {
        const hit = result.some((x) => x.type === type && (String(expected).startsWith('~') ? x.entity.includes(expected.slice(1)) : x.entity === expected));
        if (hit) {
            pass++;
        } else {
            fail++;
            console.log(`FAIL [${name}] 应包含 ${type}:${expected}`);
            console.log(`     实际: ${result.filter((x) => x.type === type).map((x) => x.entity).join(' | ') || '(无)'}`);
        }
    }

    for (const [type, forbidden] of exclude) {
        const pat = String(forbidden).startsWith('~') ? forbidden.slice(1) : forbidden;
        const hit = result.some((x) => x.type === type && (String(forbidden).startsWith('~') ? x.entity.includes(pat) : x.entity === pat));
        if (!hit) {
            pass++;
        } else {
            fail++;
            console.log(`FAIL [${name}] 不应包含 ${type}:${forbidden}`);
        }
    }
}

console.log(`\n基准结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
