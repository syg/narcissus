function test() {
    var x = <HT>true;
    var y = <HT>false;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
