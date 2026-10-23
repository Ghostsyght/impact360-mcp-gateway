import type { ApiDoc } from "../../lib/unifi-policy.js";
import d0 from "./network/_index.json";
import d1 from "./network/_meta.json";
import d2 from "./network/adoptdevice.json";
import d3 from "./network/connectordelete.json";
import d4 from "./network/connectorget.json";
import d5 from "./network/connectorpatch.json";
import d6 from "./network/connectorpost.json";
import d7 from "./network/connectorput.json";
import d8 from "./network/createaclrule.json";
import d9 from "./network/creatednspolicy.json";
import d10 from "./network/createfirewallpolicy.json";
import d11 from "./network/createfirewallzone.json";
import d12 from "./network/createnetwork.json";
import d13 from "./network/createtrafficmatchinglist.json";
import d14 from "./network/createvouchers.json";
import d15 from "./network/createwifibroadcast.json";
import d16 from "./network/deleteaclrule.json";
import d17 from "./network/deletednspolicy.json";
import d18 from "./network/deletefirewallpolicy.json";
import d19 from "./network/deletefirewallzone.json";
import d20 from "./network/deletenetwork.json";
import d21 from "./network/deletetrafficmatchinglist.json";
import d22 from "./network/deletevoucher.json";
import d23 from "./network/deletevouchers.json";
import d24 from "./network/deletewifibroadcast.json";
import d25 from "./network/error-handling.json";
import d26 from "./network/executeadopteddeviceaction.json";
import d27 from "./network/executeconnectedclientaction.json";
import d28 from "./network/executeportaction.json";
import d29 from "./network/filtering.json";
import d30 from "./network/getaclrule.json";
import d31 from "./network/getaclruleordering.json";
import d32 from "./network/getaclrulepage.json";
import d33 from "./network/getadopteddevicedetails.json";
import d34 from "./network/getadopteddevicelateststatistics.json";
import d35 from "./network/getadopteddeviceoverviewpage.json";
import d36 from "./network/getconnectedclientdetails.json";
import d37 from "./network/getconnectedclientoverviewpage.json";
import d38 from "./network/getcountries.json";
import d39 from "./network/getdevicetagpage.json";
import d40 from "./network/getdnspolicy.json";
import d41 from "./network/getdnspolicypage.json";
import d42 from "./network/getdpiapplicationcategories.json";
import d43 from "./network/getdpiapplications.json";
import d44 from "./network/getfirewallpolicies.json";
import d45 from "./network/getfirewallpolicy.json";
import d46 from "./network/getfirewallpolicyordering.json";
import d47 from "./network/getfirewallzone.json";
import d48 from "./network/getfirewallzones.json";
import d49 from "./network/getinfo.json";
import d50 from "./network/getlag.json";
import d51 from "./network/getlagpage.json";
import d52 from "./network/getmclagdomain.json";
import d53 from "./network/getmclagdomainpage.json";
import d54 from "./network/getnetworkdetails.json";
import d55 from "./network/getnetworkreferences.json";
import d56 from "./network/getnetworksoverviewpage.json";
import d57 from "./network/getpendingdevicepage.json";
import d58 from "./network/getradiusprofileoverviewpage.json";
import d59 from "./network/getsiteoverviewpage.json";
import d60 from "./network/getsitetositevpntunnelpage.json";
import d61 from "./network/getswitchstack.json";
import d62 from "./network/getswitchstackpage.json";
import d63 from "./network/gettingstarted.json";
import d64 from "./network/gettrafficmatchinglist.json";
import d65 from "./network/gettrafficmatchinglists.json";
import d66 from "./network/getvoucher.json";
import d67 from "./network/getvouchers.json";
import d68 from "./network/getvpnserverpage.json";
import d69 from "./network/getwansoverviewpage.json";
import d70 from "./network/getwifibroadcastdetails.json";
import d71 from "./network/getwifibroadcastpage.json";
import d72 from "./network/patchfirewallpolicy.json";
import d73 from "./network/quick_start.ansible.json";
import d74 from "./network/removedevice.json";
import d75 from "./network/updateaclrule.json";
import d76 from "./network/updateaclruleordering.json";
import d77 from "./network/updatednspolicy.json";
import d78 from "./network/updatefirewallpolicy.json";
import d79 from "./network/updatefirewallpolicyordering.json";
import d80 from "./network/updatefirewallzone.json";
import d81 from "./network/updatenetwork.json";
import d82 from "./network/updatetrafficmatchinglist.json";
import d83 from "./network/updatewifibroadcast.json";
export const documents:ApiDoc[] = [
{slug:"adoptdevice",...d2} as ApiDoc,
{slug:"connectordelete",...d3} as ApiDoc,
{slug:"connectorget",...d4} as ApiDoc,
{slug:"connectorpatch",...d5} as ApiDoc,
{slug:"connectorpost",...d6} as ApiDoc,
{slug:"connectorput",...d7} as ApiDoc,
{slug:"createaclrule",...d8} as ApiDoc,
{slug:"creatednspolicy",...d9} as ApiDoc,
{slug:"createfirewallpolicy",...d10} as ApiDoc,
{slug:"createfirewallzone",...d11} as ApiDoc,
{slug:"createnetwork",...d12} as ApiDoc,
{slug:"createtrafficmatchinglist",...d13} as ApiDoc,
{slug:"createvouchers",...d14} as ApiDoc,
{slug:"createwifibroadcast",...d15} as ApiDoc,
{slug:"deleteaclrule",...d16} as ApiDoc,
{slug:"deletednspolicy",...d17} as ApiDoc,
{slug:"deletefirewallpolicy",...d18} as ApiDoc,
{slug:"deletefirewallzone",...d19} as ApiDoc,
{slug:"deletenetwork",...d20} as ApiDoc,
{slug:"deletetrafficmatchinglist",...d21} as ApiDoc,
{slug:"deletevoucher",...d22} as ApiDoc,
{slug:"deletevouchers",...d23} as ApiDoc,
{slug:"deletewifibroadcast",...d24} as ApiDoc,
{slug:"error-handling",...d25} as ApiDoc,
{slug:"executeadopteddeviceaction",...d26} as ApiDoc,
{slug:"executeconnectedclientaction",...d27} as ApiDoc,
{slug:"executeportaction",...d28} as ApiDoc,
{slug:"filtering",...d29} as ApiDoc,
{slug:"getaclrule",...d30} as ApiDoc,
{slug:"getaclruleordering",...d31} as ApiDoc,
{slug:"getaclrulepage",...d32} as ApiDoc,
{slug:"getadopteddevicedetails",...d33} as ApiDoc,
{slug:"getadopteddevicelateststatistics",...d34} as ApiDoc,
{slug:"getadopteddeviceoverviewpage",...d35} as ApiDoc,
{slug:"getconnectedclientdetails",...d36} as ApiDoc,
{slug:"getconnectedclientoverviewpage",...d37} as ApiDoc,
{slug:"getcountries",...d38} as ApiDoc,
{slug:"getdevicetagpage",...d39} as ApiDoc,
{slug:"getdnspolicy",...d40} as ApiDoc,
{slug:"getdnspolicypage",...d41} as ApiDoc,
{slug:"getdpiapplicationcategories",...d42} as ApiDoc,
{slug:"getdpiapplications",...d43} as ApiDoc,
{slug:"getfirewallpolicies",...d44} as ApiDoc,
{slug:"getfirewallpolicy",...d45} as ApiDoc,
{slug:"getfirewallpolicyordering",...d46} as ApiDoc,
{slug:"getfirewallzone",...d47} as ApiDoc,
{slug:"getfirewallzones",...d48} as ApiDoc,
{slug:"getinfo",...d49} as ApiDoc,
{slug:"getlag",...d50} as ApiDoc,
{slug:"getlagpage",...d51} as ApiDoc,
{slug:"getmclagdomain",...d52} as ApiDoc,
{slug:"getmclagdomainpage",...d53} as ApiDoc,
{slug:"getnetworkdetails",...d54} as ApiDoc,
{slug:"getnetworkreferences",...d55} as ApiDoc,
{slug:"getnetworksoverviewpage",...d56} as ApiDoc,
{slug:"getpendingdevicepage",...d57} as ApiDoc,
{slug:"getradiusprofileoverviewpage",...d58} as ApiDoc,
{slug:"getsiteoverviewpage",...d59} as ApiDoc,
{slug:"getsitetositevpntunnelpage",...d60} as ApiDoc,
{slug:"getswitchstack",...d61} as ApiDoc,
{slug:"getswitchstackpage",...d62} as ApiDoc,
{slug:"gettingstarted",...d63} as ApiDoc,
{slug:"gettrafficmatchinglist",...d64} as ApiDoc,
{slug:"gettrafficmatchinglists",...d65} as ApiDoc,
{slug:"getvoucher",...d66} as ApiDoc,
{slug:"getvouchers",...d67} as ApiDoc,
{slug:"getvpnserverpage",...d68} as ApiDoc,
{slug:"getwansoverviewpage",...d69} as ApiDoc,
{slug:"getwifibroadcastdetails",...d70} as ApiDoc,
{slug:"getwifibroadcastpage",...d71} as ApiDoc,
{slug:"patchfirewallpolicy",...d72} as ApiDoc,
{slug:"quick_start.ansible",...d73} as ApiDoc,
{slug:"removedevice",...d74} as ApiDoc,
{slug:"updateaclrule",...d75} as ApiDoc,
{slug:"updateaclruleordering",...d76} as ApiDoc,
{slug:"updatednspolicy",...d77} as ApiDoc,
{slug:"updatefirewallpolicy",...d78} as ApiDoc,
{slug:"updatefirewallpolicyordering",...d79} as ApiDoc,
{slug:"updatefirewallzone",...d80} as ApiDoc,
{slug:"updatenetwork",...d81} as ApiDoc,
{slug:"updatetrafficmatchinglist",...d82} as ApiDoc,
{slug:"updatewifibroadcast",...d83} as ApiDoc
];
export const docsMetadata = {"slug":"_meta","app":"network","version":"10.6.106","scrapedAt":"2026-10-12T13:49:27.320Z","pageCount":82};
