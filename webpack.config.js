const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');
const fs = require('fs');
const path = require('path');

class CopyWorkerFilesPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CopyWorkerFilesPlugin', () => {
            const workerDir = path.resolve(__dirname, 'worker');
            const utilsDir = path.resolve(__dirname, 'utils');
            const distWorkerDir = path.resolve(__dirname, 'dist', 'worker');
            const distUtilsDir = path.resolve(__dirname, 'dist', 'utils');

            // 创建 dist/worker 和 dist/utils 目录
            if (!fs.existsSync(distWorkerDir)) {
                fs.mkdirSync(distWorkerDir, { recursive: true });
            }
            if (!fs.existsSync(distUtilsDir)) {
                fs.mkdirSync(distUtilsDir, { recursive: true });
            }

            // 复制所有 worker 文件（parsePDF、diff、sharp）
            const workerFiles = fs.readdirSync(workerDir)
                .filter(file =>
                    file.includes('.worker.') ||
                    file === 'EventCenter.js'
                );

            workerFiles.forEach(file => {
                const srcPath = path.join(workerDir, file);
                const destPath = path.join(distWorkerDir, file);
                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`Copied: ${file} -> dist/worker/`);
                }
            });

            // 递归复制整个 utils 目录
            const copyDir = (src, dest) => {
                const entries = fs.readdirSync(src, { withFileTypes: true });

                for (const entry of entries) {
                    const srcPath = path.join(src, entry.name);
                    const destPath = path.join(dest, entry.name);

                    if (entry.isDirectory()) {
                        if (!fs.existsSync(destPath)) {
                            fs.mkdirSync(destPath, { recursive: true });
                        }
                        copyDir(srcPath, destPath);
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                }
            };

            console.log('Copying utils directory...');
            copyDir(utilsDir, distUtilsDir);
            console.log('Copied: utils/ -> dist/utils/');
        });
    }
}

module.exports = {
    entry: './index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'BidComparator.js',
        library: {
            type: 'commonjs2',
        },
        clean: true, // 每次构建前清理输出目录
    },
    mode: process.env.NODE_ENV || 'production',
    devtool: 'source-map', // 生成sourcemap
    target: 'node',
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    // 排除Node.js内置模块和node_modules中的依赖
    externalsPresets: {
        node: true,
    }, // in order to ignore built-in modules like path, fs, etc.
    externals: [
        nodeExternals({
            allowlist: [],
            // 排除 worker 文件，不打包进 bundle
            importType: 'commonjs',
            modulesFromFile: false,
        }),
        // 额外排除所有 worker 文件，保持原始路径
        function({ request }, callback) {
            if (request.includes('./worker/') && request.includes('.worker.')) {
                return callback(null, 'commonjs ' + request);
            }
            callback();
        },
    ],
    plugins: [
        new CopyWorkerFilesPlugin(),
    ],
    // externals: {
    //     sharp: 'commonjs sharp',
    // },
};
