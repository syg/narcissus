function test() {
    var o = {};
    o.foo = true;
    var x = true;
    if (x) {
        o.foo = false;
    }
    return !o.foo;
}
test();
