function test() {
    var x = <HT>true;
    var y;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
