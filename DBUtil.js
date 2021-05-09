class DBUtil{
    static executeSql(con,strSql, params = []) {
        console.log('come in DBUtil');
        // 这resolve代表成功的方法 reject代表失败的方法
        // Promise的写法是固定写法，这是其中的一种写法
        let promise = new Promise((resolve, reject) => {
            //第一步：先获取数据库的连接
            let conn = con;
            //第二步：执行SQL语句
            conn.query(strSql, params, (err, result) => {
                if (err) {
                    //代表执行失败  指catch
                    reject(err);
                } else {
                    //代表成功  成功以后继续操作 指then
                    resolve(result);
                }
            });
        });
        return promise; //返回这个“承诺”
    }
}
module.exports = DBUtil;