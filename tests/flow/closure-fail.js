function test() {
    var x = <H>true;
    var y;
    function k() { y = false; }
    if (x) {
        k();
    }
    return !y;
}
test();
